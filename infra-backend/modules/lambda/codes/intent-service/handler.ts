/**
 * Intent service — goal → clarify → plan → confirm → Step Functions.
 *
 * This is the value-path API for Home. Clarification questions are owned here
 * so the UI never waits on unstructured model text to become a product.
 * The Clarification agent is invoked when present; missing keys still block
 * auto-enabling voice.
 */
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const lambda = new LambdaClient({});
const sfn    = new SFNClient({});
const ssm    = new SSMClient({});
const ddb    = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});

const CRM_WRITE_ARN = process.env.CRM_WRITE_SERVICE_ARN!;
const CRM_READ_ARN  = process.env.CRM_READ_SERVICE_ARN!;
const INVOKER_ARN   = process.env.AGENT_INVOKER_ARN!;
const TABLE         = process.env.DYNAMODB_TABLE!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-impulsoiq-tenant',
  'Content-Type': 'application/json',
};

const DEEP_RESEARCH_TOKENS = 4 * 8_000 + 5_000;

const ssmCache = new Map<string, string>();

async function ssmValue(pathEnv: string): Promise<string> {
  const name = process.env[pathEnv];
  if (!name) return '';
  const cached = ssmCache.get(name);
  if (cached) return cached;
  const resp = await ssm.send(new GetParameterCommand({ Name: name }));
  const value = resp.Parameter?.Value ?? '';
  if (value) ssmCache.set(name, value);
  return value;
}

async function stateMachineArn(): Promise<string> {
  if (process.env.STATE_MACHINE_ARN) return process.env.STATE_MACHINE_ARN;
  return ssmValue('STATE_MACHINE_ARN_SSM_PATH');
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

function actorId(event: Parameters<APIGatewayProxyHandler>[0]): string {
  const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
  return claims?.sub ?? 'human';
}

async function invokeJson(functionArn: string, payload: unknown): Promise<Record<string, unknown>> {
  const out = await lambda.send(new InvokeCommand({
    FunctionName: functionArn,
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  const text = Buffer.from(out.Payload ?? new Uint8Array()).toString('utf8');
  const parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (out.FunctionError) {
    throw new Error(String(parsed.errorMessage ?? parsed.error ?? text));
  }
  return parsed;
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

async function crmRead(tenantId: string, operation: string, payload: Record<string, unknown>) {
  return invokeJson(CRM_READ_ARN, { operation, payload, tenantId });
}

async function crmWrite(tenantId: string, operation: string, payload: Record<string, unknown>, actor: string) {
  return invokeJson(CRM_WRITE_ARN, {
    operation, payload, tenantId, actorType: 'human', actorId: actor,
  });
}

async function recordActivation(
  tenantId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
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
}

type Answers = {
  channels?: string[];
  approvalMode?: string;
  maxTouches?: number;
  goalType?: string;
  sequenceId?: string;
};

type Question = { id: string; prompt: string; options: { id: string; label: string }[] };

const EXPANSION_STARTERS: Record<string, string> = {
  cs_renewal: 'customer_success_renewal',
  recruiting_coord: 'recruiting_coordination',
  vendor_ops: 'vendor_ops_coordination',
  appointment_sched: 'appointment_scheduling',
};

function expansionConfig(config: unknown): { csDesignPartner: boolean } {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { csDesignPartner: false };
  }
  const expansion = (config as Record<string, unknown>).expansion;
  if (!expansion || typeof expansion !== 'object' || Array.isArray(expansion)) {
    return { csDesignPartner: false };
  }
  return { csDesignPartner: (expansion as Record<string, unknown>).csDesignPartner === true };
}

function isPayingCsPartner(tier: string, config: unknown): boolean {
  const paid = tier === 'starter' || tier === 'growth' || tier === 'enterprise';
  return paid && expansionConfig(config).csDesignPartner;
}

async function assertExpansionStarter(tenantId: string, starter: string | undefined): Promise<string | null> {
  if (!starter || !(starter in EXPANSION_STARTERS)) return null;
  const res = await crmRead(tenantId, 'get_tenant', {});
  const row = (res.result ?? null) as { tier?: string; config?: unknown } | null;
  if (!row || !isPayingCsPartner(String(row.tier ?? 'free'), row.config)) {
    return 'CS and other non-sales Home starters require a paying design-partner workspace. Set the flag on Templates after the tenant is on a paid plan.';
  }
  return null;
}

function missingQuestions(answers: Answers, starter?: string): Question[] {
  const q: Question[] = [];
  if (!answers.goalType) {
    q.push({
      id: 'goalType',
      prompt: 'What should this run achieve?',
      options: [
        { id: 'lead_qualification', label: 'Qualify inbound leads' },
        { id: 'follow_up', label: 'Follow up quiet deals' },
        { id: 'outreach', label: 'Draft first-touch outreach' },
      ],
    });
  }
  if (!answers.channels || answers.channels.length === 0) {
    q.push({
      id: 'channels',
      prompt: 'Which channels are approved for this run?',
      options: [
        { id: 'email', label: 'Email only' },
        { id: 'email,call', label: 'Email, then a call if they engage' },
      ],
    });
  }
  if (!answers.approvalMode && starter !== 'running_agents') {
    q.push({
      id: 'approvalMode',
      prompt: 'How much approval do you want before outbound?',
      options: [
        { id: 'every_send', label: 'Approve every send (recommended while we learn)' },
        { id: 'first_n', label: 'Approve the first few, then run' },
      ],
    });
  }
  return q;
}

function applyAnswer(answers: Answers, id: string, value: string): Answers {
  const next = { ...answers };
  if (id === 'channels') next.channels = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (id === 'approvalMode') next.approvalMode = value;
  if (id === 'goalType') next.goalType = value;
  if (id === 'maxTouches') next.maxTouches = Number(value);
  return next;
}

function seedFromStarter(starter: string | undefined, answers: Answers): Answers {
  const next = { ...answers };
  if (starter === 'qualify_inbound') {
    next.goalType = next.goalType ?? 'lead_qualification';
  }
  if (starter === 'quiet_deals') {
    next.goalType = next.goalType ?? 'follow_up';
  }
  if (starter === 'draft_outreach') {
    next.goalType = next.goalType ?? 'outreach';
    next.channels = next.channels ?? ['email'];
  }
  if (starter === 'cs_renewal') {
    next.goalType = next.goalType ?? 'follow_up';
  }
  if (starter === 'recruiting_coord' || starter === 'vendor_ops' || starter === 'appointment_sched') {
    next.goalType = next.goalType ?? 'outreach';
    next.channels = next.channels ?? ['email'];
  }
  return next;
}

async function resolveTargets(
  tenantId: string,
  starter: string | undefined,
  explicitIds: string[] | undefined,
): Promise<{ contactIds: string[]; label: string }> {
  if (explicitIds && explicitIds.length > 0) {
    return { contactIds: explicitIds, label: `${explicitIds.length} selected contacts` };
  }
  if (starter === 'qualify_inbound') {
    const res = await crmRead(tenantId, 'list_contacts', { page: 1, pageSize: 25, stage: 'Prospecting' });
    const result = res.result as { items?: { id: string }[] } | undefined;
    const ids = (result?.items ?? []).map((c) => c.id);
    return { contactIds: ids, label: 'Inbound / Prospecting contacts' };
  }
  if (starter === 'quiet_deals') {
    const res = await crmRead(tenantId, 'get_deal_activity_ages', {});
    const rows = Array.isArray(res.result) ? res.result as Record<string, unknown>[] : [];
    const ids = rows
      .filter((r) => Number(r.days_since_activity ?? r.daysSinceActivity ?? 999) >= 14)
      .map((r) => String(r.contact_id ?? r.contactId ?? ''))
      .filter(Boolean);
    return { contactIds: [...new Set(ids)], label: 'Deals quiet 14+ days' };
  }
  if (starter === 'draft_outreach') {
    const res = await crmRead(tenantId, 'list_contacts', { page: 1, pageSize: 25 });
    const result = res.result as { items?: { id: string }[] } | undefined;
    const ids = (result?.items ?? []).map((c) => c.id);
    return { contactIds: ids, label: 'Current contact list' };
  }
  const res = await crmRead(tenantId, 'list_contacts', { page: 1, pageSize: 10 });
  const result = res.result as { items?: { id: string }[] } | undefined;
  return { contactIds: (result?.items ?? []).map((c) => c.id), label: 'Workspace contacts' };
}

function planFor(goal: string, answers: Answers, contactCount: number, requiresApproval: boolean) {
  const channels = answers.channels ?? ['email'];
  const steps: { agent: string; action: string }[] = [
    { agent: 'research_enrichment', action: `Enrich ${contactCount} contact${contactCount === 1 ? '' : 's'}` },
  ];
  if (channels.includes('email')) {
    steps.push({
      agent: 'outreach',
      action: requiresApproval ? 'Draft email and wait for approval' : 'Send email',
    });
  }
  if (channels.includes('call')) {
    steps.push({ agent: 'voice', action: 'Place qualification call (consent + DNC gated)' });
  }
  const cost = {
    enrichmentLookups: contactCount,
    emailSends: channels.includes('email') ? contactCount : 0,
    estimatedCallMinutes: channels.includes('call') ? contactCount * 2 : 0,
  };
  return {
    goal,
    goalType: answers.goalType ?? 'lead_qualification',
    channels,
    approvalMode: answers.approvalMode ?? 'every_send',
    maxTouches: answers.maxTouches ?? 5,
    requiresApproval,
    steps,
    cost,
    topology: 'graph',
  };
}

function applyFreeGates(
  plan: ReturnType<typeof planFor>,
  hitl: { requiresApproval?: boolean; voiceAllowed?: boolean; tier?: string },
  answers: Answers,
) {
  const free = hitl.tier === 'free' || hitl.voiceAllowed === false;
  const requiresApproval = free || hitl.requiresApproval !== false || answers.approvalMode === 'every_send';
  const channels = free ? plan.channels.filter((c) => c !== 'call') : plan.channels;
  const steps = free
    ? plan.steps.filter((s) => s.agent !== 'voice')
    : plan.steps;
  if (free && (answers.channels ?? []).includes('call')) {
    steps.push({
      agent: 'voice',
      action: 'Voice is not included on Free — upgrade to Starter to place calls',
    });
  }
  return {
    ...plan,
    channels,
    requiresApproval,
    steps,
    cost: {
      ...plan.cost,
      estimatedCallMinutes: free ? 0 : plan.cost.estimatedCallMinutes,
    },
    voiceAllowed: !free,
    voicePaywall: free && (answers.channels ?? []).includes('call'),
    tier: hitl.tier ?? 'free',
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const tenantId = tenantFromEvent(event);
  if (!tenantId) return json(401, { error: 'Missing tenant_id' });
  if (!hasWorkspaceRole(event)) {
    return json(403, { error: 'This account has not been granted access to its workspace' });
  }
  const actor = actorId(event);

  let body: {
    operation?: string;
    goal?: string;
    starter?: string;
    answers?: Record<string, string>;
    contactIds?: string[];
    campaignName?: string;
    researchGoal?: string;
    icp?: string;
    approved?: boolean;
    eventType?: string;
    data?: Record<string, unknown>;
  };
  try {
    body = JSON.parse(event.body ?? '{}') as typeof body;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const operation = body.operation;
  try {
    if (operation === 'record_event') {
      const eventType = body.eventType;
      if (!eventType) return json(400, { error: 'eventType is required' });
      await recordActivation(tenantId, eventType, body.data ?? {});
      return json(200, { ok: true });
    }

    if (operation === 'submit_goal' || operation === 'resolve') {
      const goal = (body.goal ?? '').trim();
      if (!goal) return json(400, { error: 'goal is required' });
      if (body.starter === 'running_agents') {
        return json(200, { status: 'navigate', href: '/control-panel' });
      }
      const expansionBlock = await assertExpansionStarter(tenantId, body.starter);
      if (expansionBlock) return json(403, { error: expansionBlock });

      let answers: Answers = seedFromStarter(body.starter, {});
      for (const [id, value] of Object.entries(body.answers ?? {})) {
        answers = applyAnswer(answers, id, value);
      }

      if (operation === 'submit_goal') {
        await recordActivation(tenantId, 'goal_submitted', { goal, starter: body.starter });
        const clarificationArn = await ssmValue('CLARIFICATION_ARN_SSM_PATH');
        if (clarificationArn && INVOKER_ARN) {
          try {
            await invokeJson(INVOKER_ARN, {
              agentRuntimeArn: clarificationArn,
              payload: { tenantId, goal, starter: body.starter },
            });
          } catch (err) {
            console.warn('clarification invoke failed', err);
          }
        }
      }

      const questions = missingQuestions(answers, body.starter);
      if (questions.length > 0) {
        return json(200, { status: 'needs_clarification', goal, starter: body.starter, questions, answers });
      }

      const targets = await resolveTargets(tenantId, body.starter, body.contactIds);
      const hitl = await crmRead(tenantId, 'get_hitl_status', {});
      const hitlResult = (hitl.result ?? {}) as { requiresApproval?: boolean; voiceAllowed?: boolean; tier?: string };
      const plan = applyFreeGates(
        planFor(goal, answers, targets.contactIds.length, hitlResult.requiresApproval !== false),
        hitlResult,
        answers,
      );
      await recordActivation(tenantId, 'clarification_completed', {
        goal, answers, contactCount: targets.contactIds.length,
      });
      return json(200, {
        status: 'plan',
        goal,
        starter: body.starter,
        answers,
        targets,
        plan,
      });
    }

    if (operation === 'confirm') {
      const goal = (body.goal ?? '').trim();
      if (!goal) return json(400, { error: 'goal is required' });
      const expansionBlock = await assertExpansionStarter(tenantId, body.starter);
      if (expansionBlock) return json(403, { error: expansionBlock });
      let answers: Answers = seedFromStarter(body.starter, {});
      for (const [id, value] of Object.entries(body.answers ?? {})) {
        answers = applyAnswer(answers, id, value);
      }
      const targets = await resolveTargets(tenantId, body.starter, body.contactIds);
      if (targets.contactIds.length === 0) {
        return json(409, {
          error: 'No contacts in this segment yet. Seed or import contacts before confirming a run.',
          targets,
        });
      }
      const paused = await isSendPaused(tenantId);
      if (paused.paused) {
        return json(409, {
          error: paused.reason === 'account_kill'
            ? 'Account kill is in effect. Clear it from the Control Panel before starting a run.'
            : 'Outbound is paused for this workspace.',
          reason: paused.reason,
        });
      }
      const hitl = await crmRead(tenantId, 'get_hitl_status', {});
      const hitlResult = (hitl.result ?? {}) as { requiresApproval?: boolean; voiceAllowed?: boolean; tier?: string };
      const plan = applyFreeGates(
        planFor(goal, answers, targets.contactIds.length, hitlResult.requiresApproval !== false),
        hitlResult,
        answers,
      );
      const requiresApproval = plan.requiresApproval;
      const name = body.campaignName?.trim() || goal.slice(0, 80);

      const created = await crmWrite(tenantId, 'upsert_campaign', {
        name,
        type: 'sdr_qualification',
        status: 'active',
        goalTemplate: goal,
        config: {
          goal,
          guardrails: {
            maxTouches: plan.maxTouches,
            channels: plan.channels,
            approvalMode: plan.approvalMode,
          },
          requiresApproval,
          targetSegment: body.starter ?? 'contacts',
          channels: plan.channels,
          contactIds: targets.contactIds,
          sequenceId: typeof answers.sequenceId === 'string' ? answers.sequenceId : undefined,
          ...(body.starter && EXPANSION_STARTERS[body.starter]
            ? { templateKey: EXPANSION_STARTERS[body.starter] }
            : {}),
        },
      }, actor);
      const campaignId = String(created.id);

      // NOT approval_acted: confirming a plan is not approving a draft. The
      // Approvals inbox (execution-controller) emits that one; run_started
      // below already marks the run beginning.
      await recordActivation(tenantId, 'campaign_created', {
        campaignId, goal, requiresApproval,
      });

      const smArn = await stateMachineArn();
      if (!smArn) return json(500, { error: 'STATE_MACHINE_ARN is not configured' });

      const DEFAULT_STEPS = plan.voiceAllowed
        ? [
            { id: 'email-1', type: 'email' },
            { id: 'wait-1', type: 'wait', waitSeconds: 172800 },
            { id: 'call-1', type: 'call' },
          ]
        : [
            { id: 'email-1', type: 'email' },
            { id: 'wait-1', type: 'wait', waitSeconds: 172800 },
          ];
      let cadence: { id: string | null; name: string; steps: unknown[] } = {
        id: null, name: 'Default SDR cadence', steps: DEFAULT_STEPS,
      };
      const seqId = typeof answers.sequenceId === 'string' ? answers.sequenceId : '';
      if (seqId) {
        const seq = await crmRead(tenantId, 'get_sequence', { id: seqId });
        const row = (seq.result ?? seq) as Record<string, unknown> | null;
        if (row && Array.isArray(row.steps)) {
          cadence = { id: String(row.id), name: String(row.name ?? 'Sequence'), steps: row.steps };
        }
      }

      const agentRunIds: string[] = [];
      const executions = [];
      for (const contactId of targets.contactIds) {
        const agentRunId = randomUUID();
        agentRunIds.push(agentRunId);
        const started = await sfn.send(new StartExecutionCommand({
          stateMachineArn: smArn,
          name: `${campaignId.slice(0, 8)}-${contactId.slice(0, 8)}-${Date.now()}`,
          input: JSON.stringify({
            tenantId,
            campaignId,
            contactId,
            agentRunId,
            campaignConfig: {
              requiresApproval,
              channels: plan.channels,
              goal,
              voiceAllowed: plan.voiceAllowed,
              tier: plan.tier,
              ...(body.starter && EXPANSION_STARTERS[body.starter]
                ? { templateKey: EXPANSION_STARTERS[body.starter] }
                : {}),
            },
            ...(body.starter && EXPANSION_STARTERS[body.starter]
              ? { templateKey: EXPANSION_STARTERS[body.starter] }
              : {}),
            sequence: cadence,
            currentStep: { stepIndex: -1 },
          }),
        }));
        executions.push(started.executionArn);
      }

      await recordActivation(tenantId, 'run_started', {
        campaignId, agentRunIds, started: executions.length,
      });

      return json(202, {
        ok: true,
        status: 'started',
        campaignId,
        agentRunIds,
        started: executions.length,
        requiresApproval,
        inspectHref: `/control-panel?campaign=${campaignId}`,
      });
    }

    if (operation === 'deep_research') {
      const researchGoal = (body.researchGoal ?? body.goal ?? '').trim();
      if (!researchGoal) return json(400, { error: 'researchGoal is required' });
      if (!body.approved) {
        return json(200, {
          status: 'needs_approval',
          estimatedTokens: DEEP_RESEARCH_TOKENS,
          message: `This Swarm research uses about ${DEEP_RESEARCH_TOKENS.toLocaleString()} tokens across four strategies. Re-submit with approved=true to run.`,
        });
      }
      const arn = await ssmValue('DEEP_RESEARCH_ARN_SSM_PATH');
      if (!arn || !INVOKER_ARN) {
        return json(503, { error: 'Deep Research runtime is not configured' });
      }
      const run = await crmWrite(tenantId, 'upsert_agent_run', {
        agentType: 'deep_research',
        status: 'running',
        input: { goal: researchGoal, icp: body.icp ?? '', approved: true },
      }, actor);
      // Fire-and-forget: the Swarm outlives API Gateway's 29s integration
      // timeout. Waiting here produced a 504 with no CORS headers, which the
      // browser reported as a CORS failure. agent-invoker marks the run done.
      const started = await lambda.send(new InvokeCommand({
        FunctionName: INVOKER_ARN,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          agentRuntimeArn: arn,
          completeRun: {
            tenantId,
            agentRunId: run.id,
            agentType: 'deep_research',
          },
          payload: {
            tenantId,
            goal: researchGoal,
            icp: body.icp ?? '',
            approved: true,
            agentRunId: run.id,
          },
        })),
      }));
      if (started.StatusCode && started.StatusCode >= 400) {
        await crmWrite(tenantId, 'upsert_agent_run', {
          id: run.id,
          agentType: 'deep_research',
          status: 'failed',
          error: 'Could not start Deep Research (async invoke rejected)',
        }, actor);
        return json(502, { error: 'Could not start Deep Research', id: run.id });
      }
      await recordActivation(tenantId, 'run_started', { kind: 'deep_research', id: run.id });
      return json(202, {
        ok: true,
        status: 'started',
        id: run.id,
        inspectHref: `/control-panel?run=${run.id}`,
      });
    }

    return json(400, { error: `Unknown operation: ${operation}` });
  } catch (err) {
    console.error('intent-service failed', err);
    return json(500, { error: (err as Error).message });
  }
};
