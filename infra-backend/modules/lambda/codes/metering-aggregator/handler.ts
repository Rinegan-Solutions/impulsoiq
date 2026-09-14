/**
 * Metering Aggregator — DynamoDB Streams consumer (Phase 3C).
 *
 * Reads NEW_IMAGE records from the events table stream. For agent-related
 * events, atomically increments per-tenant, per-period metering counters.
 *
 * Counters are checked SYNCHRONOUSLY by the Coordinator before metered
 * operations (check_metering_quota tool — Phase 3 replaces the stub).
 *
 * Metering table schema:
 *   PK: {tenantId}#meter#{period}    e.g. demo#meter#2026-09
 *   SK: {resourceType}               e.g. agent_runs, llm_tokens, call_minutes
 *   count:      atomic counter (ADD)
 *   cost_units: micro-USD (ADD)
 *
 * Cost model (approximate, for quota display — not billing):
 *   llm_tokens:           $0.003 per 1K input tokens (Claude Sonnet)
 *   call_minutes:         $0.05  per minute (CALL-E estimate)
 *   enrichment_lookups:   $0.01  per lookup
 *   email_sends:          $0.0001 per email (SES)
 *   sms_sends:            $0.005  per SMS (SNS)
 *   agent_runs:           $0.001  per run (Lambda + coordination overhead)
 */
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const METERING_TABLE = process.env.METERING_TABLE!;

// Micro-USD cost per unit (divide by 1_000_000 for USD)
const COST_TABLE: Record<string, number> = {
  llm_tokens:          3,      // $0.003/1K tokens = 3 micro-USD per token (×1000 in counter)
  call_minutes:        50_000, // $0.05/minute
  enrichment_lookups:  10_000, // $0.01/lookup
  email_sends:         100,    // $0.0001/email
  sms_sends:           5_000,  // $0.005/SMS
  agent_runs:          1_000,  // $0.001/run
};

// 13-month TTL (billing history retention)
const BILLING_TTL_SECONDS = 13 * 30 * 86_400;

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function increment(tenantId: string, period: string, resource: string, amount: number): Promise<void> {
  const costPerUnit  = COST_TABLE[resource] ?? 0;
  const ttl          = Math.floor(Date.now() / 1000) + BILLING_TTL_SECONDS;

  await dynamo.send(new UpdateCommand({
    TableName:        METERING_TABLE,
    Key:              { pk: `${tenantId}#meter#${period}`, sk: resource },
    UpdateExpression: 'ADD #count :n, #cost :c SET #ttl = if_not_exists(#ttl, :ttl)',
    ExpressionAttributeNames: {
      '#count': 'count',
      '#cost':  'cost_units',
      '#ttl':   'ttl',
    },
    ExpressionAttributeValues: {
      ':n':   amount,
      ':c':   amount * costPerUnit,
      ':ttl': ttl,
    },
  }));
}

export const handler: DynamoDBStreamHandler = async (event) => {
  const period = currentPeriod();

  for (const record of event.Records) {
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') continue;
    if (!record.dynamodb?.NewImage) continue;

    const image = unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>);

    const tenantId   = image['tenantId']   as string | undefined;
    const entityType = image['entityType'] as string | undefined;
    const eventType  = image['eventType']  as string | undefined;
    const data       = image['data']       as Record<string, unknown> | undefined;

    if (!tenantId) continue;

    // ── agent_run created / updated ─────────────────────────────────────────
    if (entityType === 'agent_run' && eventType === 'created') {
      await increment(tenantId, period, 'agent_runs', 1);

      // Estimate LLM token usage from agent type (rough approximation)
      const agentType = (data?.agent_type ?? data?.agentType ?? '') as string;
      const tokenEstimates: Record<string, number> = {
        coordinator:          2_000,
        clarification:        1_000,
        'research-enrichment': 5_000,
        outreach:             4_000,
        voice:                1_500,
        nurture:              1_200,
        'forecasting-insight': 3_000,
        'data-hygiene':       2_500,
      };
      const tokens = tokenEstimates[agentType] ?? 2_000;
      await increment(tenantId, period, 'llm_tokens', tokens);
    }

    // ── call_result created (voice call completed) ──────────────────────────
    if (entityType === 'call_result' && eventType === 'created') {
      const durationSeconds = ((data?.duration_seconds ?? data?.durationSeconds) as number) ?? 120;
      const minutes         = Math.ceil(durationSeconds / 60);
      await increment(tenantId, period, 'call_minutes', minutes);
    }

    // ── activity created (email/SMS send) ───────────────────────────────────
    if (entityType === 'activity' && eventType === 'created') {
      const activityType = (data?.type ?? '') as string;
      if (activityType === 'email') {
        await increment(tenantId, period, 'email_sends', 1);
      } else if (activityType === 'sms') {
        await increment(tenantId, period, 'sms_sends', 1);
      }
    }

    if (entityType === 'enrichment_record' && eventType === 'created') {
      await increment(tenantId, period, 'enrichment_lookups', 1);
    }

    // ── contact enrichment written (legacy memory path) ─────────────────────
    if (entityType === 'memory' && (data as Record<string, unknown>)?.['memory_type'] === 'enrichment_summary') {
      await increment(tenantId, period, 'enrichment_lookups', 1);
    }
  }
};
