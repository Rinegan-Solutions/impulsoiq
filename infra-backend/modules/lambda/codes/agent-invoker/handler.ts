/**
 * Agent Invoker — the shim between AWS services and AgentCore Runtime.
 *
 * WHY THIS EXISTS
 * An AgentCore runtime is NOT a Lambda. Its ARN is
 *   arn:aws:bedrock-agentcore:<region>:<acct>:runtime/<name>
 * and it is invoked through the bedrock-agentcore DATA plane
 * (InvokeAgentRuntime), not lambda:InvokeFunction.
 *
 * That distinction is invisible until something enforces it:
 *   - EventBridge Scheduler rejects it at CREATE time --
 *     "bedrock-agentcore is not a supported service for a target".
 *   - Step Functions and Lambda-to-Lambda calls fail only at RUN time, which is
 *     far more expensive to discover.
 *
 * So anything that wants to run an agent on a schedule, or from a state machine,
 * or from another Lambda, targets THIS function and passes the agent's ARN in
 * the payload. One shim, one place that knows how AgentCore is actually called.
 *
 * Input:
 *   {
 *     agentRuntimeArn: string,          // required
 *     payload?: object,                 // forwarded to the agent verbatim
 *     qualifier?: string,               // runtime endpoint, default "DEFAULT"
 *     runtimeSessionId?: string         // reuse to continue a session
 *     completeRun?: { tenantId, agentRunId, agentType }
 *   }
 *
 * Output:
 *   { ok: true,  statusCode, agentRuntimeArn, sessionId, response }
 *   { ok: false, agentRuntimeArn, error }
 *
 * Failures are returned, not thrown, when invoked on a schedule: a thrown error
 * costs a Scheduler retry and an alarm for something a caller may treat as
 * routine. THROW_ON_ERROR=1 restores throwing for callers (Step Functions Catch
 * blocks) that need the failure to propagate.
 */
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';

const client = new BedrockAgentCoreClient({});
const lambda = new LambdaClient({});
const THROW_ON_ERROR = process.env.THROW_ON_ERROR === '1';
const CRM_WRITE_ARN = process.env.CRM_WRITE_SERVICE_ARN ?? '';

interface CompleteRun {
  tenantId: string;
  agentRunId: string;
  agentType: string;
}

interface InvokeRequest {
  agentRuntimeArn?: string;
  payload?: Record<string, unknown>;
  qualifier?: string;
  runtimeSessionId?: string;
  /** Step Functions Catch needs a thrown error; Scheduler prefers a returned failure. */
  throwOnError?: boolean;
  /** When set, write this agent_run completed/failed after the runtime returns. */
  completeRun?: CompleteRun;
}

/** Collect the agent's streamed response body into a string. */
async function readBody(body: unknown): Promise<string> {
  if (body == null) return '';
  const maybe = body as { transformToString?: () => Promise<string> };
  if (typeof maybe.transformToString === 'function') {
    return maybe.transformToString();
  }
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (typeof body === 'string') return body;

  const iterable = body as AsyncIterable<Uint8Array>;
  if (typeof (iterable as never)[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of iterable) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }
  return String(body);
}

async function markRun(
  complete: CompleteRun,
  status: 'completed' | 'failed',
  extra: { output?: Record<string, unknown>; error?: string },
): Promise<void> {
  if (!CRM_WRITE_ARN) {
    console.error('completeRun skipped: CRM_WRITE_SERVICE_ARN is not set');
    return;
  }
  await lambda.send(new InvokeCommand({
    FunctionName: CRM_WRITE_ARN,
    Payload: Buffer.from(JSON.stringify({
      operation: 'upsert_agent_run',
      tenantId: complete.tenantId,
      actorType: 'agent',
      actorId: 'agent-invoker',
      payload: {
        id: complete.agentRunId,
        agentType: complete.agentType,
        status,
        ...extra,
      },
    })),
  }));
}

export const handler = async (event: InvokeRequest) => {
  const throwOnError = THROW_ON_ERROR || event?.throwOnError === true;
  const agentRuntimeArn = event?.agentRuntimeArn;
  if (!agentRuntimeArn) {
    const error = 'agentRuntimeArn is required';
    if (event.completeRun) {
      await markRun(event.completeRun, 'failed', { error }).catch((err) => {
        console.error('completeRun failed', err);
      });
    }
    if (throwOnError) throw new Error(error);
    return { ok: false, agentRuntimeArn: null, error };
  }

  const sessionId = event.runtimeSessionId ?? randomUUID();

  try {
    const resp = await client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn,
        qualifier: event.qualifier ?? 'DEFAULT',
        runtimeSessionId: sessionId,
        payload: Buffer.from(JSON.stringify(event.payload ?? {}), 'utf8'),
      }),
    );

    const raw = await readBody(resp.response);
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // Agent returned plain text — pass it through rather than failing.
    }

    if (event.completeRun) {
      const output = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { response: parsed };
      await markRun(event.completeRun, 'completed', { output }).catch((err) => {
        console.error('completeRun failed', err);
      });
    }

    return {
      ok: true,
      statusCode: resp.statusCode ?? 200,
      agentRuntimeArn,
      sessionId,
      response: parsed,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('InvokeAgentRuntime failed', { agentRuntimeArn, sessionId, error });
    if (event.completeRun) {
      await markRun(event.completeRun, 'failed', { error }).catch((markErr) => {
        console.error('completeRun failed', markErr);
      });
    }
    if (throwOnError) throw err;
    return { ok: false, agentRuntimeArn, sessionId, error };
  }
};
