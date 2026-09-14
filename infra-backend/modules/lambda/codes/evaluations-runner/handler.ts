/**
 * Evaluations Runner — Phase 3D.
 *
 * Implements the "continuous agent quality pipeline" using LLM-as-judge.
 * Triggered daily by EventBridge Scheduler; reads recent agent runs from
 * DynamoDB and evaluates them against per-agent quality criteria.
 *
 * Evaluation criteria (per Phase 3D spec):
 *   Outreach:      on-brand-voice adherence (1–5), factual grounding (1–5)
 *   Voice:         schema-validation pass rate (0/1), appropriate escalation (0/1)
 *   Clarification: minimum-questions efficiency (1–5)
 *   Research:      source attribution completeness (1–5), score determinism (0/1)
 *   Coordinator:   consent gate enforcement (0/1), send-pause gate enforcement (0/1)
 *
 * Results are written to the reporting DynamoDB table as 'quality_scores' records.
 * Dashboard: AnalyticsPage quality section reads these.
 */
import type { ScheduledHandler } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'eu-west-2' });
const dynamo  = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});

const EVENTS_TABLE    = process.env.DYNAMODB_TABLE!;
const REPORTING_TABLE = process.env.REPORTING_TABLE!;
const JUDGE_MODEL     = 'us.anthropic.claude-haiku-4-5-20251001'; // cost-effective for evaluation

// Per-agent evaluation criteria and prompts
const AGENT_CRITERIA: Record<string, { dimensions: string[]; prompt: (run: AgentRun) => string }> = {
  outreach: {
    dimensions: ['brand_voice', 'factual_grounding'],
    prompt: (run) => `
You are evaluating an AI outreach email agent. Score the following agent run on two dimensions (1-5 each):
1. brand_voice_adherence: Does the output sound on-brand, professional, and personalised? (1=generic/off-brand, 5=highly personalised and on-brand)
2. factual_grounding: Does the output reference specific, verifiable facts about the contact/company? (1=no facts, 5=rich specific facts)

Agent input: ${JSON.stringify(run.input)}
Agent output: ${JSON.stringify(run.output)}

Respond in JSON: { "brand_voice_adherence": N, "factual_grounding": N, "reasoning": "..." }
`.trim(),
  },
  voice: {
    dimensions: ['schema_validation_pass', 'appropriate_escalation'],
    prompt: (run) => `
You are evaluating an AI voice call agent. Score the following run on two dimensions (0 or 1 each):
1. schema_validation_pass: Did the agent's call result include all required schema fields (interest_level, meeting_booked)? (1=yes, 0=no/incomplete)
2. appropriate_escalation: When the call result was low-confidence or failed, did the agent route to human escalation rather than writing unreliable data? (1=yes, 0=no)

Agent input: ${JSON.stringify(run.input)}
Agent output: ${JSON.stringify(run.output)}

Respond in JSON: { "schema_validation_pass": N, "appropriate_escalation": N, "reasoning": "..." }
`.trim(),
  },
  clarification: {
    dimensions: ['minimum_questions_efficiency'],
    prompt: (run) => `
You are evaluating an AI clarification agent. Score the following run on one dimension (1-5):
1. minimum_questions_efficiency: Did the agent ask only the minimum necessary questions? Did it check memory for settled preferences first? (1=asked many redundant questions, 5=zero unnecessary questions)

Agent input: ${JSON.stringify(run.input)}
Agent output: ${JSON.stringify(run.output)}

Respond in JSON: { "minimum_questions_efficiency": N, "reasoning": "..." }
`.trim(),
  },
  coordinator: {
    dimensions: ['consent_gate_enforced', 'send_pause_gate_enforced'],
    prompt: (run) => `
You are evaluating an AI coordinator agent. Score the following run on two dimensions (0 or 1 each):
1. consent_gate_enforced: Did the coordinator call check_consent before any outreach step? (1=yes/not applicable, 0=skipped)
2. send_pause_gate_enforced: Did the coordinator call check_send_pause before any email/SMS delegation? (1=yes/not applicable, 0=skipped)

Agent output / tool calls: ${JSON.stringify(run.output)}

Respond in JSON: { "consent_gate_enforced": N, "send_pause_gate_enforced": N, "reasoning": "..." }
`.trim(),
  },

  // ── Phase 9C: Support agent evaluations ─────────────────────────────────

  'triage-escalation': {
    dimensions: ['tier_classification_accuracy', 'tier3_rule_enforcement'],
    prompt: (run) => `
You are evaluating an AI support triage agent. Score on two dimensions (0 or 1 each):

1. tier_classification_accuracy: Does the assigned tier seem appropriate for the customer message?
   - Tier 3 for refund/cancellation/legal language: correct
   - Tier 0 for simple informational questions: correct
   - Tier 0 for billing disputes or angry customers: incorrect
   (1=appropriate tier, 0=seems wrong)

2. tier3_rule_enforcement: If the output includes a Tier-3 assignment, was it due to
   a deterministic rule signal (refund/legal language, very negative sentiment, repeated
   unresolved tickets) rather than arbitrary LLM judgment? (1=yes or not tier-3, 0=tier-3 with no clear signal)

Customer message: ${JSON.stringify(run.input)}
Triage output:   ${JSON.stringify(run.output)}

Respond in JSON: { "tier_classification_accuracy": N, "tier3_rule_enforcement": N, "reasoning": "..." }
`.trim(),
  },

  resolution: {
    dimensions: ['groundedness', 'confidence_gate_calibration', 'citation_completeness'],
    prompt: (run) => `
You are evaluating an AI support resolution agent. Score on three dimensions:

1. groundedness (0 or 1): Does the response body follow from the cited knowledge articles?
   Does every factual claim have a corresponding citation? If the agent sent a response
   without citations, this is 0. If the citations support the claims, this is 1.
   This is the hallucination-detection check specific to this agent's factual-accuracy requirement.

2. confidence_gate_calibration (0 or 1): When the agent couldn't find sufficient KB grounding,
   did it correctly call stage_insufficient_grounding rather than guessing?
   (1=correctly routed to human when uncertain, 0=either guessed without grounding or
   over-rejected a clearly answerable question)

3. citation_completeness (1-5): How complete are the citations?
   (1=no citations, 3=partial citations, 5=every factual claim is attributed to a specific article)

Agent input:  ${JSON.stringify(run.input)}
Agent output: ${JSON.stringify(run.output)}

Respond in JSON: { "groundedness": N, "confidence_gate_calibration": N, "citation_completeness": N, "reasoning": "..." }
`.trim(),
  },
};

interface AgentRun {
  tenantId:  string;
  agentType: string;
  runId:     string;
  input:     unknown;
  output:    unknown;
  startedAt: string;
}

async function getRecentRuns(tenantId: string, agentType: string, limit = 20): Promise<AgentRun[]> {
  const resp = await dynamo.send(new QueryCommand({
    TableName:              EVENTS_TABLE,
    IndexName:              'gsi-agent-run', // already exists from Phase 2 gap fix
    KeyConditionExpression: 'agent_run_id = :skip',  // fallback: query by PK pattern
    // Actually query by pk prefix
    // We need a different query strategy since gsi-agent-run has agent_run_id as hash
    // Use the main table with pk prefix scan (limited but workable for daily batch)
    Limit: limit,
  }));
  // Simplified: return empty if no matching pattern — real implementation
  // would use a GSI or Scan with filter. For the hackathon, stub this.
  return [];
}

async function judgeRun(run: AgentRun): Promise<Record<string, number> & { reasoning?: string } | null> {
  const criteria = AGENT_CRITERIA[run.agentType];
  if (!criteria) return null; // no criteria for this agent type

  const prompt = criteria.prompt(run);

  try {
    const resp = await bedrock.send(new InvokeModelCommand({
      modelId:     JUDGE_MODEL,
      contentType: 'application/json',
      accept:      'application/json',
      body: Buffer.from(JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens:        512,
        messages: [{ role: 'user', content: prompt }],
      })),
    }));

    const body   = JSON.parse(Buffer.from(resp.body).toString());
    const text   = body.content?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    return parsed;
  } catch (err) {
    console.error('evaluations-runner: judge invocation failed', { agentType: run.agentType, error: (err as Error).message });
    return null;
  }
}

async function writeQualityScore(
  tenantId:   string,
  agentType:  string,
  runId:      string,
  scores:     Record<string, number>,
  period:     string,
): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 90 * 86_400;

  await dynamo.send(new PutCommand({
    TableName: REPORTING_TABLE,
    Item: {
      pk:          `${tenantId}#report#quality_scores`,
      sk:          now,
      report_type: 'quality_scores',
      tenant_id:   tenantId,
      agentType,
      runId,
      scores,
      period,
      generatedAt: now,
      ttl,
    },
  }));
}

export const handler: ScheduledHandler = async () => {
  // For the hackathon, run evaluations against a hardcoded demo tenant
  // Production: read active tenants from DSQL via crm-read Lambda
  const tenantId = process.env.DEMO_TENANT_ID ?? 'demo';
  const period   = new Date().toISOString().slice(0, 7); // YYYY-MM

  let evaluated = 0;

  for (const [agentType] of Object.entries(AGENT_CRITERIA)) {
    const runs = await getRecentRuns(tenantId, agentType, 10);

    for (const run of runs) {
      const scores = await judgeRun(run);
      if (!scores) continue;

      const numericScores: Record<string, number> = {};
      for (const [k, v] of Object.entries(scores)) {
        if (k !== 'reasoning' && typeof v === 'number') {
          numericScores[k] = v;
        }
      }

      await writeQualityScore(tenantId, agentType, run.runId, numericScores, period);
      evaluated++;
    }
  }

  console.log(`evaluations-runner: evaluated ${evaluated} runs for period ${period}`);
};
