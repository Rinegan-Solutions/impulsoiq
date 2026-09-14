/**
 * Nurture Trigger Lambda.
 *
 * Triggered by SNS when SES fires an engagement event (open, click, bounce,
 * complaint). Parses the contact's tenantId + contactId from the event,
 * reads cadence state from DynamoDB, and invokes the Nurture agent if
 * re-engagement is appropriate.
 *
 * This is the "subscribes to engagement events" piece from Phase 2F spec.
 */
import type { SNSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});
const lambda = new LambdaClient({});

const TABLE           = process.env.DYNAMODB_TABLE!;
const NURTURE_AGENT   = process.env.NURTURE_AGENT_ARN ?? '';
// Minimum hours between nurture triggers for the same contact
const MIN_TRIGGER_GAP_HOURS = 24;

interface SesEvent {
  eventType: string;
  mail: { tags?: Record<string, string[]> };
}

function extractContactIds(sesEvent: SesEvent): { tenantId?: string; contactId?: string } {
  // ImpulsoIQ embeds tenantId and contactId as SES message tags
  const tags = sesEvent.mail.tags ?? {};
  return {
    tenantId:  tags['impulsoiq:tenantId']?.[0],
    contactId: tags['impulsoiq:contactId']?.[0],
  };
}

async function shouldTrigger(tenantId: string, contactId: string): Promise<boolean> {
  // Read last nurture trigger timestamp from DynamoDB
  const item = await dynamo.send(new GetCommand({
    TableName: TABLE,
    Key: {
      pk: `${tenantId}#nurture_triggers#${contactId}`,
      sk: 'last_trigger',
    },
  }));

  if (!item.Item) return true; // first time — trigger

  const lastTrigger = new Date(item.Item.triggeredAt as string);
  const hoursElapsed = (Date.now() - lastTrigger.getTime()) / 3_600_000;
  return hoursElapsed >= MIN_TRIGGER_GAP_HOURS;
}

async function recordTrigger(tenantId: string, contactId: string, eventType: string): Promise<void> {
  await dynamo.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk:          `${tenantId}#nurture_triggers#${contactId}`,
      sk:          'last_trigger',
      tenantId,
      contactId,
      eventType,
      triggeredAt: new Date().toISOString(),
      ttl:         Math.floor(Date.now() / 1000) + 30 * 86400, // 30-day TTL
    },
  }));
}

export const handler: SNSHandler = async (event) => {
  for (const record of event.Records) {
    let sesEvent: SesEvent;
    try {
      sesEvent = JSON.parse(record.Sns.Message) as SesEvent;
    } catch {
      console.warn('nurture-trigger: could not parse SNS message', { msg: record.Sns.Message });
      continue;
    }

    const { tenantId, contactId } = extractContactIds(sesEvent);

    if (!tenantId || !contactId) {
      // Event not tagged with ImpulsoIQ identifiers — skip (could be a test send)
      continue;
    }

    const eventType = sesEvent.eventType ?? 'unknown';
    const kind = eventType.toLowerCase();

    if (kind === 'bounce' || kind === 'complaint') {
      const writeArn = process.env.CRM_WRITE_SERVICE_ARN;
      if (writeArn) {
        await lambda.send(new InvokeCommand({
          FunctionName: writeArn,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({
            operation: 'upsert_activity',
            tenantId,
            actorType: 'agent',
            actorId: 'nurture-trigger',
            payload: {
              contactId,
              type: 'note',
              actorType: 'agent',
              actorId: 'nurture-trigger',
              subject: kind === 'bounce' ? 'Email bounced' : 'Complaint received',
              body: `SES ${kind} for this contact. Deliverability risk — sequence should not keep sending blindly.`,
              metadata: { kind: kind === 'bounce' ? 'bounce' : 'complaint', eventType },
            },
          })),
        }));
      }
      continue;
    }

    // Only trigger on positive engagement signals — not bounces/complaints
    const POSITIVE_EVENTS = new Set(['open', 'click', 'reply']);
    if (!POSITIVE_EVENTS.has(eventType.toLowerCase())) {
      console.log('nurture-trigger: skipping non-positive event', { eventType, contactId });
      continue;
    }

    // Rate-limit: don't trigger nurture for the same contact more than once per MIN_TRIGGER_GAP_HOURS
    if (!(await shouldTrigger(tenantId, contactId))) {
      console.log('nurture-trigger: within cooldown, skipping', { tenantId, contactId, eventType });
      continue;
    }

    // Invoke Nurture agent
    if (NURTURE_AGENT) {
      await lambda.send(new InvokeCommand({
        FunctionName:   NURTURE_AGENT,
        InvocationType: 'Event', // async — don't wait for result
        Payload: Buffer.from(JSON.stringify({
          tenantId,
          contactId,
          triggerEvent:  eventType,
          triggeredAt:   new Date().toISOString(),
        })),
      }));
      await recordTrigger(tenantId, contactId, eventType);
      console.log('nurture-trigger: invoked nurture agent', { tenantId, contactId, eventType });
    } else {
      console.warn('nurture-trigger: NURTURE_AGENT_ARN not set — skipping invocation');
    }
  }
};
