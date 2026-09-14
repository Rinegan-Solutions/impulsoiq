/**
 * Send Pause Enforcer — reacts to SES reputation CloudWatch alarms.
 *
 * Triggered by SNS when:
 *   - Bounce rate exceeds 5%
 *   - Complaint rate exceeds 0.1%
 *
 * Writes a send_pause flag to DynamoDB with a 24-hour TTL.
 * The Outreach agent reads this flag via check_send_pause before every send.
 *
 * Key schema:
 *   PK: {tenantId}#send_flags#send_pause  (or "global" for alarm-level pause)
 *   SK: current
 */
import type { SNSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb      = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE    = process.env.DYNAMODB_TABLE!;
const TTL_SECS = 24 * 60 * 60; // 24 hours

interface SendPauseRecord {
  pk:       string;
  sk:       string;
  paused:   boolean;
  reason:   string;
  pausedAt: string;
  ttl:      number;
}

async function writePauseFlag(tenantId: string, reason: string): Promise<void> {
  const now     = Math.floor(Date.now() / 1000);
  const record: SendPauseRecord = {
    pk:       `${tenantId}#send_flags#send_pause`,
    sk:       'current',
    paused:   true,
    reason,
    pausedAt: new Date().toISOString(),
    ttl:      now + TTL_SECS,
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: record }));
  console.log('Send pause written', { tenantId, reason });
}

export const handler: SNSHandler = async (event) => {
  for (const record of event.Records) {
    let alarmPayload: Record<string, unknown>;
    try {
      alarmPayload = JSON.parse(record.Sns.Message) as Record<string, unknown>;
    } catch {
      console.error('Failed to parse SNS message', record.Sns.Message);
      continue;
    }

    const alarmName = (alarmPayload.AlarmName as string) ?? '';
    const reason    = alarmName.includes('Bounce') ? 'bounce_rate_exceeded'
                    : alarmName.includes('Complaint') ? 'complaint_rate_exceeded'
                    : 'reputation_alarm';

    // The alarm fires at the SES configuration-set level (not per tenant for hackathon).
    // We write a global pause that all tenants' check_send_pause will see.
    // Phase 3: parse tenant_id from alarm dimensions when per-tenant SES config sets exist.
    await writePauseFlag('global', reason);
  }
};

// ── Utility: check_send_pause — used by agents via direct Lambda invocation ──

export async function checkSendPause(tenantId: string): Promise<{ paused: boolean; reason?: string }> {
  // Check both tenant-specific and global pause flags
  const keys = [
    { pk: `${tenantId}#send_flags#send_pause`, sk: 'current' },
    { pk: 'global#send_flags#send_pause',      sk: 'current' },
  ];

  for (const key of keys) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
    if (res.Item && (res.Item as SendPauseRecord).paused) {
      return { paused: true, reason: (res.Item as SendPauseRecord).reason };
    }
  }
  return { paused: false };
}
