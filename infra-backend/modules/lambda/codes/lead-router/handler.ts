/**
 * Lead Router — inbound lead ingestion and deterministic routing.
 *
 * Receives inbound lead webhooks (form submissions, Typeform, etc.).
 * This is a RULES ENGINE, NOT an agent — routing is deterministic.
 *
 * Flow:
 * 1. Parse inbound contact data
 * 2. Call crm-write-service to upsert the contact
 * 3. Determine the right campaign using territory/industry rules
 * 4. Assign to a rep using round-robin capacity tracking in DynamoDB
 * 5. Start a Step Functions execution for research enrichment
 * 6. Update the contact with assigned owner
 *
 * Input:  { tenantId, firstName, lastName, email, company, source, formData? }
 * Output: { contactId, assignedTo, campaignId, agentRunId }
 */
import type { APIGatewayProxyEvent, Handler } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const lambda = new LambdaClient({});
const sfn    = new SFNClient({});
const ddb    = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});

const CRM_WRITE_ARN     = process.env.CRM_WRITE_SERVICE_ARN!;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;
const DYNAMODB_TABLE    = process.env.DYNAMODB_TABLE!;

interface LeadRouterInput {
  tenantId:   string;
  firstName:  string;
  lastName:   string;
  email:      string;
  company?:   string;
  phone?:     string;
  source:     string;
  formData?:  Record<string, unknown>;
}

interface RouteResult {
  contactId:  string;
  assignedTo: string;
  campaignId: string;
  agentRunId: string;
}

// ── CRM Write helper ──────────────────────────────────────────────────────────

async function invokeCrmWrite(operation: string, payload: Record<string, unknown>, tenantId: string): Promise<Record<string, unknown>> {
  const resp = await lambda.send(new InvokeCommand({
    FunctionName:   CRM_WRITE_ARN,
    InvocationType: 'RequestResponse',
    Payload:        Buffer.from(JSON.stringify({ operation, payload, tenantId, actorType: 'agent', actorId: 'lead-router' })),
  }));
  const result = JSON.parse(Buffer.from(resp.Payload!).toString()) as Record<string, unknown>;
  if (resp.FunctionError) throw new Error(`CRM write failed: ${JSON.stringify(result)}`);
  return result;
}

// ── Territory-based routing rules (deterministic) ────────────────────────────

/** Extract domain from email address. */
function domainFromEmail(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/** Map industry/domain to territory bucket. */
function inferTerritory(email: string, company?: string): string {
  const domain = domainFromEmail(email);

  // Enterprise domains by TLD patterns — extend per tenant config in production
  if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 'public_sector';
  if (['healthcare', 'pharma', 'medtech'].some(k => (company ?? '').toLowerCase().includes(k))) return 'healthcare';
  if (['fintech', 'bank', 'capital', 'fund'].some(k => (company ?? '').toLowerCase().includes(k))) return 'financial';
  return 'general'; // fallback — round-robin pool
}

/**
 * Round-robin rep assignment using DynamoDB counter.
 * Uses conditional increment to handle concurrent writes safely.
 */
async function assignRepRoundRobin(tenantId: string, territory: string): Promise<string> {
  const pk = `${tenantId}#routing#${territory}`;
  const sk = 'round_robin_counter';

  // For hackathon: return a placeholder SDR ID.
  // Production: fetch rep list from config, increment counter mod len(reps).
  try {
    const res = await ddb.send(new UpdateCommand({
      TableName:                 DYNAMODB_TABLE,
      Key:                       { pk, sk },
      UpdateExpression:          'SET #c = if_not_exists(#c, :zero) + :one',
      ExpressionAttributeNames:  { '#c': 'counter' },
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
      ReturnValues:              'UPDATED_NEW',
    }));
    const counter = (res.Attributes?.counter ?? 0) as number;
    // Placeholder: rotate over 3 mock reps
    const reps = ['sdr-001', 'sdr-002', 'sdr-003'];
    return reps[counter % reps.length];
  } catch {
    return 'sdr-001'; // safe fallback
  }
}

/**
 * Find the best active campaign for a given territory.
 * For hackathon: returns the first active campaign or a default.
 */
async function findCampaignForTerritory(tenantId: string, _territory: string): Promise<string | null> {
  const pk = `${tenantId}#campaigns#active`;
  try {
    const res = await ddb.send(new QueryCommand({
      TableName:                 DYNAMODB_TABLE,
      KeyConditionExpression:    'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      Limit:                     1,
    }));
    return (res.Items?.[0]?.campaignId as string) ?? null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function route(input: LeadRouterInput): Promise<RouteResult> {
  const { tenantId, firstName, lastName, email, company, phone, source, formData } = input;

  // 1. Upsert contact via CRM Write Service
  const contactResult = await invokeCrmWrite('upsert_contact', {
    firstName,
    lastName,
    email,
    phone:        phone ?? null,
    customFields: { source, formData: formData ?? {} },
  }, tenantId);
  const contactId = contactResult.id as string;

  // 2. Determine routing rules
  const territory = inferTerritory(email, company);
  const assignedTo = await assignRepRoundRobin(tenantId, territory);
  const campaignId = await findCampaignForTerritory(tenantId, territory) ?? 'default-campaign';

  // 3. Create an agent_run record for the research enrichment kick-off
  const agentRunResult = await invokeCrmWrite('upsert_agent_run', {
    contactId,
    campaignId,
    agentType: 'research_enrichment',
    status:    'pending',
    input:     { source, territory, assignedTo },
  }, tenantId);
  const agentRunId = agentRunResult.id as string;

  // 4. Update contact with assigned owner (stored in custom_fields)
  await invokeCrmWrite('upsert_contact', {
    id:           contactId,
    firstName,
    lastName,
    email,
    customFields: { source, assignedTo, territory, formData: formData ?? {} },
  }, tenantId);

  // 5. Start Step Functions execution for the campaign
  const executionName = `lead-${contactId.substring(0, 8)}-${Date.now()}`;
  const execution = await sfn.send(new StartExecutionCommand({
    stateMachineArn: STATE_MACHINE_ARN,
    name:            executionName,
    input:           JSON.stringify({ tenantId, contactId, campaignId, agentRunId, source }),
  }));

  // 6. Attach execution ARN to the agent_run record
  await invokeCrmWrite('upsert_agent_run', {
    id:                          agentRunId,
    contactId,
    campaignId,
    agentType:                   'research_enrichment',
    status:                      'running',
    stepFunctionsExecutionArn:   execution.executionArn,
  }, tenantId);

  return { contactId, assignedTo, campaignId, agentRunId };
}

// ── Entry point (API Gateway + direct Lambda invocation) ─────────────────────

export const handler: Handler<
  LeadRouterInput | APIGatewayProxyEvent,
  RouteResult | { statusCode: number; body: string }
> = async (event) => {
  let input: LeadRouterInput;

  if ('requestContext' in event) {
    const apigwEvent = event as APIGatewayProxyEvent;
    // COGNITO_USER_POOLS authorizer: verified ID-token claims, flat string map.
    const claims = apigwEvent.requestContext?.authorizer?.claims as
      | Record<string, string>
      | undefined;
    const tenantId = claims?.['custom:tenant_id'] ?? null;
    if (!tenantId) return { statusCode: 401, body: JSON.stringify({ error: 'Missing tenant_id' }) };
    // The claim is chosen by the browser at sign-up; membership is the Cognito
    // group tenant-provisioner grants. Same rule as hasWorkspaceRole in crm-read.
    const groups = String(claims?.['cognito:groups'] ?? '').split(/[\s,[\]"]+/);
    if (!groups.some((g) => g === 'admin' || g === 'manager' || g === 'member')) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This account has not been granted access to its workspace' }) };
    }
    const body = JSON.parse(apigwEvent.body ?? '{}') as Omit<LeadRouterInput, 'tenantId'>;
    input = { ...body, tenantId };
  } else {
    input = event as LeadRouterInput;
  }

  if (!input.tenantId || !input.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenantId and email are required' }) };
  }

  try {
    const result = await route(input);
    return 'requestContext' in event
      ? { statusCode: 200, body: JSON.stringify(result) }
      : result;
  } catch (err) {
    const msg = (err as Error).message;
    console.error('Lead routing failed', { email: input.email, error: msg });
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
};
