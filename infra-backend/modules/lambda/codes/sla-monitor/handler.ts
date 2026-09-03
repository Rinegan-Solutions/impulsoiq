/**
 * SLA Monitor Lambda — Phase 7.
 *
 * Runs every 5 minutes (EventBridge Scheduler). Non-agentic — pure
 * deterministic SLA enforcement. (v4 §7C point 5)
 *
 * Actions:
 *   1. Find tickets where sla_target_at < NOW() AND sla_breached_at IS NULL
 *      AND conversation.status NOT IN ('resolved','closed')
 *   2. Mark them as breached (set sla_breached_at = NOW())
 *   3. Auto-escalate tier (increment by 1, cap at 3) per breach_escalation_rule
 *   4. Publish breach event to DynamoDB (→ AppSync → rep queue real-time alert)
 *
 * This is the same "routing is a rules engine, not an agent call" pattern
 * already established in Phase 2B's inbound lead routing.
 */
import type { ScheduledHandler } from 'aws-lambda';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const REGION         = process.env.AWS_REGION ?? 'eu-west-2';
const DSQL_ENDPOINT  = process.env.DSQL_ENDPOINT!;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE!;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

let _db: Client | null = null;

async function getDb(): Promise<Client> {
  if (_db) { try { await _db.query('SELECT 1'); return _db; } catch { _db = null; } }
  const token  = await new DsqlSigner({ hostname: DSQL_ENDPOINT, region: REGION }).getDbConnectAdminAuthToken();
  const client = new Client({ host: DSQL_ENDPOINT, database: 'postgres', user: 'admin',
    password: token, port: 5432, ssl: { rejectUnauthorized: false } });
  await client.connect();
  _db = client;
  return client;
}

async function publishBreachEvent(tenantId: string, ticketId: string, conversationId: string, newTier: number) {
  const now = new Date().toISOString();
  await dynamo.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      pk:             `${tenantId}#sla_breach#${ticketId}`,
      sk:             now,
      tenantId,
      entityType:     'ticket',
      entityId:       ticketId,
      conversationId,
      eventType:      'sla_breach',
      newTier,
      occurredAt:     now,
      ttl:            Math.floor(Date.now() / 1000) + 30 * 86400,
    },
  }));
}

export const handler: ScheduledHandler = async () => {
  const db = await getDb();

  // Find all breached-but-not-marked tickets across all tenants
  const breached = await db.query(`
    SELECT t.id       AS ticket_id,
           t.tenant_id,
           t.conversation_id,
           t.tier,
           t.assigned_rep_id,
           sq.sla_policy_id,
           sp.breach_escalation_rule
    FROM   ticket        t
    JOIN   conversation  c  ON c.id  = t.conversation_id
    LEFT   JOIN support_queue sq ON sq.id = t.queue_id
    LEFT   JOIN sla_policy    sp ON sp.id = sq.sla_policy_id
    WHERE  t.sla_target_at   < NOW()
      AND  t.sla_breached_at IS NULL
      AND  c.status NOT IN ('resolved','closed')
    LIMIT  200
  `);

  let breachedCount = 0;

  for (const row of breached.rows) {
    const ticketId      = row.ticket_id as string;
    const tenantId      = row.tenant_id as string;
    const conversationId = row.conversation_id as string;
    const currentTier   = (row.tier as number) ?? 1;
    const newTier       = Math.min(currentTier + 1, 3);

    // Mark breached + escalate tier in one atomic update
    await db.query(
      `UPDATE ticket SET
         sla_breached_at = NOW(),
         tier            = $1,
         priority        = CASE WHEN $1 = 3 THEN 'urgent' ELSE priority END,
         updated_at      = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [newTier, ticketId, tenantId],
    );

    // Publish real-time breach event for AppSync → rep queue
    await publishBreachEvent(tenantId, ticketId, conversationId, newTier);
    breachedCount++;
  }

  console.log(`sla-monitor: marked ${breachedCount} SLA breaches`);
};
