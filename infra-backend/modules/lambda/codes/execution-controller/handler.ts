/**
 * Execution controller — pause / resume / kill that actually stops Step Functions.
 *
 * STANDARD executions cannot be paused in place. Pause and kill both call
 * StopExecution. Resume starts a new execution from the stored input.
 * An in-flight CALL-E call may still complete; the graph will not continue.
 */
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  SFNClient, StartExecutionCommand, StopExecutionCommand,
  SendTaskSuccessCommand, SendTaskFailureCommand,
} from '@aws-sdk/client-sfn';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { appSecret } from './secrets';

const sfn    = new SFNClient({});
const lambda = new LambdaClient({});
const ssm    = new SSMClient({});
const ddb    = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CRM_WRITE_ARN  = process.env.CRM_WRITE_SERVICE_ARN!;
const CRM_READ_ARN   = process.env.CRM_READ_SERVICE_ARN!;
const TABLE          = process.env.DYNAMODB_TABLE!;
const ENV            = process.env.ENV ?? 'dev';

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

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function tenantFromEvent(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
  return claims?.['custom:tenant_id'] ?? null;
}

function hasWorkspaceRole(event: Parameters<APIGatewayProxyHandler>[0]): boolean {
  const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
  const groups = String(claims?.['cognito:groups'] ?? '').split(/[\s,[\]"]+/);
  return groups.some((g) => g === 'admin' || g === 'manager' || g === 'member');
}

async function invokeJson(functionArn: string, payload: unknown): Promise<Record<string, unknown>> {
  const out = await lambda.send(new InvokeCommand({
    FunctionName: functionArn,
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  const text = Buffer.from(out.Payload ?? new Uint8Array()).toString('utf8');
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

async function crmRead(tenantId: string, operation: string, payload: Record<string, unknown>) {
  return invokeJson(CRM_READ_ARN, { operation, payload, tenantId });
}

/**
 * Activation log (Phase 2D instrumentation).
 *
 * `approval_acted` belongs HERE — the moment an operator approves, edits or
 * rejects a draft in the Approvals inbox — not at plan-confirm time, where
 * `run_started` already records that a run began. Activation is defined as
 * first_outbound_sent OR approval_acted ON A DRAFT, so emitting it on confirm
 * counted every started run as a human approval.
 */
async function recordActivation(
  tenantId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `${tenantId}#activation#log`,
        sk: `${now}#${eventType}`,
        tenantId,
        entityType: 'activation',
        entityId: eventType,
        eventType,
        occurredAt: now,
        data,
        ttl: Math.floor(Date.now() / 1000) + 7 * 365 * 24 * 3600,
      },
    }));
  } catch (err) {
    // Instrumentation must never fail the operator's action.
    console.warn('recordActivation failed', err);
  }
}

async function crmWrite(tenantId: string, operation: string, payload: Record<string, unknown>, actorId: string) {
  return invokeJson(CRM_WRITE_ARN, {
    operation, payload, tenantId, actorType: 'human', actorId,
  });
}

type RunRow = {
  id: string;
  status: string;
  agentType?: string;
  contactId?: string;
  campaignId?: string;
  stepFunctionsExecutionArn?: string;
  input?: Record<string, unknown>;
};

function asRun(raw: Record<string, unknown>): RunRow {
  return {
    id: String(raw.id),
    status: String(raw.status),
    agentType: raw.agent_type ? String(raw.agent_type) : raw.agentType ? String(raw.agentType) : undefined,
    contactId: (raw.contact_id ?? raw.contactId) ? String(raw.contact_id ?? raw.contactId) : undefined,
    campaignId: (raw.campaign_id ?? raw.campaignId) ? String(raw.campaign_id ?? raw.campaignId) : undefined,
    stepFunctionsExecutionArn: (raw.step_functions_execution_arn ?? raw.stepFunctionsExecutionArn)
      ? String(raw.step_functions_execution_arn ?? raw.stepFunctionsExecutionArn) : undefined,
    input: (raw.input && typeof raw.input === 'object') ? raw.input as Record<string, unknown> : {},
  };
}

async function loadRun(tenantId: string, id: string): Promise<RunRow | null> {
  const res = await crmRead(tenantId, 'get_agent_run', { id });
  const row = (res.result ?? null) as Record<string, unknown> | null;
  return row ? asRun(row) : null;
}

async function stopExecution(arn: string, cause: string): Promise<{ stopped: boolean; error?: string }> {
  try {
    await sfn.send(new StopExecutionCommand({ executionArn: arn, error: 'KILLED_BY_USER', cause }));
    return { stopped: true };
  } catch (err) {
    const msg = (err as Error).message;
    // Already finished is success for kill/pause intent.
    if (/not running|does not exist|aborted/i.test(msg)) return { stopped: true };
    return { stopped: false, error: msg };
  }
}

async function cancelCalleCall(callId: string): Promise<{ cancelled: boolean; reason?: string }> {
  if (!callId) return { cancelled: false, reason: 'no_call_id' };
  if (callId.startsWith('stub-')) return { cancelled: true, reason: 'stub' };
  const base = process.env.CALLE_BASE_URL;
  if (!base) return { cancelled: false, reason: 'vendor_unconfigured' };
  let apiKey = process.env.CALLE_API_KEY ?? '';
  if (!apiKey) {
    try {
      apiKey = await appSecret('calle_api_key');
    } catch {
      return { cancelled: false, reason: 'calle_key_unreadable' };
    }
  }
  if (!apiKey) return { cancelled: false, reason: 'calle_key_missing' };
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/calls/${encodeURIComponent(callId)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      return { cancelled: false, reason: 'vendor_has_no_cancel' };
    }
    if (!res.ok) return { cancelled: false, reason: `http_${res.status}` };
    return { cancelled: true };
  } catch (err) {
    return { cancelled: false, reason: (err as Error).message };
  }
}

async function lookupInFlightCall(tenantId: string, runId: string): Promise<{ callId?: string; idempotencyKey?: string }> {
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `${tenantId}#call_tasks_by_run#${runId}` },
      Limit: 1,
    }));
    const item = res.Items?.[0];
    if (!item) return {};
    return {
      callId: item.callId as string | undefined,
      idempotencyKey: item.idempotencyKey as string | undefined,
    };
  } catch {
    return {};
  }
}

async function writeSendPause(tenantId: string, reason: string, ttlDays: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: `${tenantId}#send_flags#send_pause`,
      sk: 'current',
      paused: true,
      reason,
      pausedAt: new Date().toISOString(),
      ttl: now + ttlDays * 24 * 60 * 60,
      env: ENV,
    },
  }));
}

async function clearSendPause(tenantId: string): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: `${tenantId}#send_flags#send_pause`,
      sk: 'current',
      paused: false,
      reason: 'cleared',
      pausedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 3600,
    },
  }));
}

export async function isSendPaused(tenantId: string): Promise<{ paused: boolean; reason?: string }> {
  for (const pk of [`${tenantId}#send_flags#send_pause`, 'global#send_flags#send_pause']) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk: 'current' } }));
    if (res.Item?.paused === true) {
      return { paused: true, reason: String(res.Item.reason ?? 'paused') };
    }
  }
  return { paused: false };
}

async function controlRun(
  tenantId: string,
  actorId: string,
  run: RunRow,
  action: 'pause' | 'resume' | 'kill',
): Promise<Record<string, unknown>> {
  if (action === 'resume') {
    if (run.status !== 'paused') {
      return { ok: false, error: `Run ${run.id} is ${run.status}, not paused` };
    }
    const pause = await isSendPaused(tenantId);
    if (pause.paused && pause.reason === 'account_kill') {
      return { ok: false, error: 'Account-wide kill is in effect; clear it before resuming' };
    }
    const input = { ...(run.input ?? {}), tenantId, contactId: run.contactId, campaignId: run.campaignId, agentRunId: run.id };
    const smArn = await stateMachineArn();
    const started = await sfn.send(new StartExecutionCommand({
      stateMachineArn: smArn,
      name: `resume-${run.id.slice(0, 8)}-${Date.now()}`,
      input: JSON.stringify(input),
    }));
    await crmWrite(tenantId, 'upsert_agent_run', {
      id: run.id,
      contactId: run.contactId,
      campaignId: run.campaignId,
      agentType: run.agentType ?? 'coordinator',
      status: 'running',
      stepFunctionsExecutionArn: started.executionArn,
      input,
      error: null,
    }, actorId);
    return { ok: true, id: run.id, executionArn: started.executionArn, resumed: true };
  }

  const cause = action === 'pause' ? 'paused_by_user' : 'killed_by_user';
  let stopped = false;
  let stopError: string | undefined;
  if (run.stepFunctionsExecutionArn) {
    const result = await stopExecution(run.stepFunctionsExecutionArn, cause);
    stopped = result.stopped;
    stopError = result.error;
  } else {
    // No ARN: the graph was never linked. Still persist the status so the UI
    // cannot claim a run is running when the operator asked to stop it.
    stopped = true;
  }

  const inFlight = await lookupInFlightCall(tenantId, run.id);
  const cancel = inFlight.callId ? await cancelCalleCall(inFlight.callId) : { cancelled: false };
  const callMayComplete = Boolean(inFlight.callId) && !cancel.cancelled;

  await crmWrite(tenantId, 'upsert_agent_run', {
    id: run.id,
    contactId: run.contactId,
    campaignId: run.campaignId,
    agentType: run.agentType ?? 'coordinator',
    status: action === 'pause' ? 'paused' : 'failed',
    stepFunctionsExecutionArn: run.stepFunctionsExecutionArn,
    input: run.input,
    error: cause,
  }, actorId);

  return {
    ok: stopped,
    id: run.id,
    stopped,
    callMayComplete,
    callCancelled: cancel.cancelled,
    callId: inFlight.callId,
    error: stopError,
    note: callMayComplete
      ? 'The graph is stopped. An in-flight CALL-E call may still complete; no further steps will run.'
      : undefined,
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const tenantId = tenantFromEvent(event);
  if (!tenantId) return json(401, { error: 'Missing tenant_id' });
  if (!hasWorkspaceRole(event)) {
    return json(403, { error: 'This account has not been granted access to its workspace' });
  }

  const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
  const actorId = claims?.sub ?? 'human';

  let body: {
    operation?: string;
    runId?: string;
    campaignId?: string;
    activityId?: string;
    action?: string;
    subject?: string;
    body?: string;
    survivorId?: string;
    duplicateId?: string;
    allowUnverifiedEmail?: boolean;
  };
  try {
    body = JSON.parse(event.body ?? '{}') as typeof body;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const operation = body.operation;
  try {
    if (operation === 'pause_run' || operation === 'resume_run' || operation === 'kill_run') {
      if (!body.runId) return json(400, { error: 'runId is required' });
      const run = await loadRun(tenantId, body.runId);
      if (!run) return json(404, { error: 'Run not found' });
      const action = operation === 'pause_run' ? 'pause' : operation === 'resume_run' ? 'resume' : 'kill';
      const result = await controlRun(tenantId, actorId, run, action);
      return json(result.ok === false ? 409 : 200, result);
    }

    if (operation === 'kill_tenant') {
      const listed = await crmRead(tenantId, 'list_active_agent_runs', {});
      const items = Array.isArray(listed.result) ? listed.result as Record<string, unknown>[]
        : Array.isArray((listed.result as { items?: unknown[] } | undefined)?.items)
          ? (listed.result as { items: Record<string, unknown>[] }).items
          : [];
      await writeSendPause(tenantId, 'account_kill', 3650);
      const results = [];
      for (const raw of items) {
        const run = asRun(raw);
        results.push(await controlRun(tenantId, actorId, run, 'kill'));
      }
      return json(200, {
        ok: true,
        pausedOutbound: true,
        reason: 'account_kill',
        stopped: results.length,
        results,
      });
    }

    if (operation === 'clear_tenant_kill') {
      await clearSendPause(tenantId);
      return json(200, { ok: true, pausedOutbound: false });
    }

    if (operation === 'pause_status') {
      const pause = await isSendPaused(tenantId);
      return json(200, { ok: true, ...pause });
    }

    if (operation === 'act_approval') {
      if (!body.activityId) return json(400, { error: 'activityId is required' });
      const action = body.action;
      if (action !== 'approve' && action !== 'reject' && action !== 'edit') {
        return json(400, { error: 'action must be approve, reject, or edit' });
      }
      const loaded = await crmRead(tenantId, 'get_activity', { id: body.activityId });
      const row = (loaded.result ?? null) as Record<string, unknown> | null;
      if (!row) return json(404, { error: 'Approval item not found' });
      const meta = (row.metadata && typeof row.metadata === 'object')
        ? { ...(row.metadata as Record<string, unknown>) } : {};
      if (meta.status !== 'awaiting_approval') {
        return json(409, { error: 'This item is no longer awaiting approval' });
      }
      const taskToken = typeof meta.taskToken === 'string' ? meta.taskToken : '';
      const proposalType = String(meta.proposalType ?? meta.kind ?? '');
      const nextStatus = action === 'reject' ? 'rejected' : 'approved';

      if (action === 'approve' && proposalType === 'merge_contacts') {
        const survivorId = body.survivorId;
        const duplicateId = body.duplicateId;
        if (!survivorId || !duplicateId) {
          return json(400, { error: 'Pick which contact to keep (survivorId) and which to merge (duplicateId). Merges never run silently.' });
        }
        await crmWrite(tenantId, 'merge_contacts', { survivorId, duplicateId }, actorId);
      }

      if (action === 'reject' && taskToken) {
        try {
          await sfn.send(new SendTaskFailureCommand({
            taskToken,
            error: 'RejectedByHuman',
            cause: 'Operator rejected the draft in Approvals',
          }));
        } catch (err) {
          console.warn('SendTaskFailure', err);
        }
      }

      if ((action === 'approve' || action === 'edit') && taskToken) {
        const subject = body.subject ?? (typeof row.subject === 'string' ? row.subject : '');
        const draftBody = body.body ?? (typeof row.body === 'string' ? row.body : '');
        try {
          await sfn.send(new SendTaskSuccessCommand({
            taskToken,
            output: JSON.stringify({
              approved: true,
              edited: action === 'edit' || Boolean(body.body || body.subject),
              subject,
              body: draftBody,
              allowUnverifiedEmail: body.allowUnverifiedEmail === true,
            }),
          }));
        } catch (err) {
          console.warn('SendTaskSuccess', err);
        }
      }

      await crmWrite(tenantId, 'patch_activity', {
        id: body.activityId,
        subject: body.subject,
        body: body.body,
        metadata: {
          ...meta,
          status: nextStatus,
          decidedBy: actorId,
          decidedAt: new Date().toISOString(),
          action,
        },
      }, actorId);

      await recordActivation(tenantId, 'approval_acted', {
        activityId: body.activityId,
        action,
        status: nextStatus,
        proposalType: proposalType || undefined,
      });

      return json(200, { ok: true, id: body.activityId, status: nextStatus });
    }

    return json(400, { error: `Unknown operation: ${operation}` });
  } catch (err) {
    console.error('execution-controller failed', err);
    return json(500, { error: (err as Error).message });
  }
};
