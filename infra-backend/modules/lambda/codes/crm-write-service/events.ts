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
  new DynamoDBClient({ region: process.env.AWS_REGION ?? 'eu-west-2' }),
);

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
      occurredAt: now,
      ttl,
    },
  }));
}
