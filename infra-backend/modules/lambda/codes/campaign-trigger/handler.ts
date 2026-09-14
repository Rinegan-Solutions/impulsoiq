import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const sfn  = new SFNClient({});
const ssm  = new SSMClient({});
const ddb  = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});
const lambda = new LambdaClient({});
const TABLE = process.env.DYNAMODB_TABLE!;
const CRM_READ = process.env.CRM_READ_SERVICE_ARN!;

export const DEFAULT_SEQUENCE_STEPS = [
  { id: 'email-1', type: 'email' },
  { id: 'wait-1', type: 'wait', waitSeconds: 172800 },
  { id: 'call-1', type: 'call' },
];

async function crmRead(tenantId: string, operation: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: CRM_READ,
    Payload: Buffer.from(JSON.stringify({ operation, payload, tenantId })),
  }));
  const raw = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString()) : {};
  return (raw.result ?? null) as Record<string, unknown> | null;
}

async function sequenceForCampaign(tenantId: string, campaignId: string): Promise<{ id: string | null; name: string; steps: unknown[] }> {
  const campaign = await crmRead(tenantId, 'get_campaign', { id: campaignId });
  const config = (campaign?.config ?? {}) as Record<string, unknown>;
  const sequenceId = typeof config.sequenceId === 'string' ? config.sequenceId : '';
  if (sequenceId) {
    const seq = await crmRead(tenantId, 'get_sequence', { id: sequenceId });
    if (seq && Array.isArray(seq.steps)) {
      return { id: String(seq.id), name: String(seq.name ?? 'Sequence'), steps: seq.steps as unknown[] };
    }
  }
  return { id: null, name: 'Default SDR cadence', steps: DEFAULT_SEQUENCE_STEPS };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-impulsoiq-tenant',
  'Content-Type': 'application/json',
};

let stateMachineArnCache: string | undefined;

async function stateMachineArn(): Promise<string> {
  if (process.env.STATE_MACHINE_ARN) return process.env.STATE_MACHINE_ARN;
  if (stateMachineArnCache) return stateMachineArnCache;
  const path = process.env.STATE_MACHINE_ARN_SSM_PATH;
  if (!path) throw new Error('STATE_MACHINE_ARN is not configured');
  const resp = await ssm.send(new GetParameterCommand({ Name: path }));
  const value = resp.Parameter?.Value ?? '';
  if (!value) throw new Error('STATE_MACHINE_ARN_SSM_PATH resolved empty');
  stateMachineArnCache = value;
  return value;
}

async function isSendPaused(tenantId: string): Promise<{ paused: boolean; reason?: string }> {
  for (const pk of [`${tenantId}#send_flags#send_pause`, 'global#send_flags#send_pause']) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk: 'current' } }));
    if (res.Item?.paused === true) {
      return { paused: true, reason: String(res.Item.reason ?? 'paused') };
    }
  }
  return { paused: false };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
  const tenantId = claims?.['custom:tenant_id'];
  if (!tenantId) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Missing tenant_id' }) };
  }
  const groups = String(claims?.['cognito:groups'] ?? '').split(/[\s,[\]"]+/);
  if (!groups.some((g) => g === 'admin' || g === 'manager' || g === 'member')) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'This account has not been granted access to its workspace' }) };
  }

  let body: {
    campaignId?: string;
    contactIds?: string[];
    requiresApproval?: boolean;
    channels?: string[];
    goal?: string;
  };
  try {
    body = JSON.parse(event.body ?? '{}') as typeof body;
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  if (!body.campaignId || !Array.isArray(body.contactIds) || body.contactIds.length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'campaignId and a non-empty contactIds array are required' }) };
  }
  const { campaignId, contactIds } = body as { campaignId: string; contactIds: string[] };
  const tenant = await crmRead(tenantId, 'get_tenant', {});
  const tier = String(tenant?.tier ?? 'free');
  const voiceAllowed = tier !== 'free';
  const requiresApproval = body.requiresApproval !== false || tier === 'free';
  let channels = Array.isArray(body.channels) ? body.channels.map(String) : ['email'];
  if (!voiceAllowed) channels = channels.filter((c) => c !== 'call');
  const campaignConfig = {
    requiresApproval,
    channels,
    goal: typeof body.goal === 'string' ? body.goal : '',
    voiceAllowed,
    tier,
  };

  const active = await crmRead(tenantId, 'list_active_agent_runs', {});
  const running = Array.isArray(active) ? active.length : 0;
  const concurrentCap = tier === 'free' ? 1 : tier === 'starter' ? 3 : tier === 'growth' ? 10 : 50;
  if (running + contactIds.length > concurrentCap) {
    return {
      statusCode: 402,
      headers: CORS,
      body: JSON.stringify({
        error: 'Concurrent run quota exceeded',
        running,
        quota: concurrentCap,
        started: 0,
      }),
    };
  }

  const pause = await isSendPaused(tenantId);
  if (pause.paused) {
    return {
      statusCode: 409,
      headers: CORS,
      body: JSON.stringify({
        error: 'Outbound is paused for this workspace',
        reason: pause.reason,
        started: 0,
      }),
    };
  }

  const smArn = await stateMachineArn();
  const cadence = await sequenceForCampaign(tenantId, campaignId);
  const agentRunIds: string[] = [];
  const executions = await Promise.all(
    contactIds.map((contactId) => {
      const agentRunId = randomUUID();
      agentRunIds.push(agentRunId);
      return sfn.send(new StartExecutionCommand({
        stateMachineArn: smArn,
        name: `${campaignId.slice(0, 8)}-${contactId.slice(0, 8)}-${Date.now()}`,
        input: JSON.stringify({
          tenantId, campaignId, contactId, agentRunId, campaignConfig,
          sequence: cadence,
          currentStep: { stepIndex: -1 },
        }),
      }));
    }),
  );

  return {
    statusCode: 202,
    headers: CORS,
    body: JSON.stringify({
      started: executions.length,
      agentRunIds,
      executionArns: executions.map((e) => e.executionArn),
    }),
  };
};
