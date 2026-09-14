/**
 * DynamoDB audit-event publisher.
 *
 * Every successful CRM write publishes a structured event to the single-table
 * DynamoDB store. This is the only fan-out path — DSQL has no triggers, so the
 * Lambda does it explicitly after each commit.
 *
 * PK:  {tenantId}#{entityType}#{entityId}
 * SK:  {isoTimestamp}#{eventType}
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? 'eu-west-2' }), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.DYNAMODB_TABLE!;

const SEVEN_YEARS_S = 7 * 365 * 24 * 3600;

export interface AuditEvent {
  tenantId:   string;
  entityType: string;
  entityId:   string;
  eventType:  'created' | 'updated' | 'deleted';
  actorType:  'human' | 'agent';
  actorId:    string;
  data:       Record<string, unknown>;
  agentType?: string;
  status?:    string;
}

export async function publishEvent(ev: AuditEvent): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + SEVEN_YEARS_S;

  await dynamo.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk:         `${ev.tenantId}#${ev.entityType}#${ev.entityId}`,
      sk:         `${now}#${ev.eventType}`,
      tenantId:   ev.tenantId,
      entityType: ev.entityType,
      entityId:   ev.entityId,
      eventType:  ev.eventType,
      actorType:  ev.actorType,
      actorId:    ev.actorId,
      data:       ev.data,
      agentType:  ev.agentType ?? (typeof ev.data.agentType === 'string' ? ev.data.agentType : undefined),
      status:     ev.status ?? (typeof ev.data.status === 'string' ? ev.data.status : undefined),
      contact_id: typeof ev.data.contactId === 'string' ? ev.data.contactId : undefined,
      campaign_id: typeof ev.data.campaignId === 'string' ? ev.data.campaignId : undefined,
      agent_run_id: typeof ev.data.agentRunId === 'string' ? ev.data.agentRunId : undefined,
      occurredAt: now,
      ttl,
    },
  }));
}

/** First-occurrence activation markers. Conditioned so they fire once per tenant. */
export async function recordFirstActivation(
  tenantId: string,
  eventType: 'first_outbound_sent' | 'first_call_placed',
  data: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await dynamo.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `${tenantId}#activation#${eventType}`,
        sk: 'current',
        tenantId,
        entityType: 'activation',
        entityId: eventType,
        eventType,
        occurredAt: now,
        data,
        ttl: Math.floor(Date.now() / 1000) + SEVEN_YEARS_S,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    await dynamo.send(new PutCommand({
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
        ttl: Math.floor(Date.now() / 1000) + SEVEN_YEARS_S,
      },
    }));
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return;
    console.error('recordFirstActivation failed', err);
  }
}
