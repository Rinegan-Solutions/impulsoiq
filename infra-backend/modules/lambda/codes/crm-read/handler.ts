/**
 * CRM Read Service — read-only queries against Aurora DSQL.
 *
 * All agents READ contact/account/activity data through this Lambda.
 * This Lambda NEVER writes to DSQL — all writes go through crm-write-service.
 *
 * Tenant isolation: every query includes a tenant_id parameter.
 * Supports both API Gateway and direct Lambda invocation from agents.
 */
import type { APIGatewayProxyHandlerV2, Handler } from 'aws-lambda';
import { getDb } from './db';

type Operation =
  | 'get_contact'
  | 'get_account'
  | 'list_contacts_for_campaign'
  | 'get_activity_history'
  | 'get_enrichment_data'
  | 'get_brand_voice_profile'
  | 'get_active_campaigns'
  | 'get_tenant'               // Phase 3: needed for metering quota (returns tier)
  | 'get_pipeline_data'        // Phase 3: deals + stages for forecasting agent
  | 'get_deal_activity_ages'   // Phase 3: days-in-stage for anomaly detection
  | 'scan_for_duplicates'      // Phase 3: fuzzy-match candidates for hygiene agent
  | 'get_workspace_templates'  // Phase 5: active templates for a tenant
  | 'get_registry'             // Phase 6B: agent/tool/template catalog
  | 'get_a2a_agent_card'       // Phase 6C: A2A agent card by key
  | 'search_knowledge_articles' // Phase 8A: KB search for Resolution Agent
  | 'get_knowledge_article'     // Phase 8A: single KB article by id
  | 'get_macros'                // Phase 8B: macro list for suggestion
  | 'get_messages'              // Phase 7/8: messages for a conversation
  | 'get_conversation'          // Phase 7/8: single conversation by id
  | 'get_support_queue'         // Phase 7: single queue by id
  | 'get_sla_policy'            // Phase 7: SLA policy by id
  | 'list_queues'               // Phase 7: list queues for routing
  | 'list_available_reps'       // Phase 7: reps with available status
  | 'count_prior_tickets'       // Phase 7/8: prior ticket count for contact
  | 'get_support_metrics'       // Phase 9A: raw support data for insight agent
  | 'get_support_signals_for_contact'; // Phase 9D: support signals for renewal risk

interface ReadRequest {
  operation: Operation;
  payload:   Record<string, unknown>;
}

interface ReadResponse {
  ok:      boolean;
  result?: unknown;
  error?:  string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tenantFromEvent(event: Parameters<APIGatewayProxyHandlerV2>[0]): string | null {
  const jwt = event.requestContext?.authorizer?.jwt?.claims;
  if (jwt?.['custom:tenant_id']) return jwt['custom:tenant_id'] as string;
  return null;
}

// ── Operations ────────────────────────────────────────────────────────────────

async function getContact(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, p: Record<string, unknown>): Promise<ReadResponse> {
  const res = await db.query(
    `SELECT * FROM contact WHERE id = $1 AND tenant_id = $2`,
    [p.id, tenantId],
  );
  if (res.rowCount === 0) return { ok: true, result: null };
  return { ok: true, result: res.rows[0] };
}

async function getAccount(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, p: Record<string, unknown>): Promise<ReadResponse> {
  const res = await db.query(
    `SELECT * FROM account WHERE id = $1 AND tenant_id = $2`,
    [p.id, tenantId],
  );
  if (res.rowCount === 0) return { ok: true, result: null };
  return { ok: true, result: res.rows[0] };
}

async function listContactsForCampaign(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, p: Record<string, unknown>): Promise<ReadResponse> {
  // Contacts linked to a campaign via agent_run records
  const res = await db.query(
    `SELECT DISTINCT c.*
     FROM contact c
     INNER JOIN agent_run ar ON ar.contact_id = c.id AND ar.tenant_id = c.tenant_id
     WHERE ar.campaign_id = $1
       AND c.tenant_id    = $2
     ORDER BY c.created_at DESC`,
    [p.campaignId, tenantId],
  );
  return { ok: true, result: res.rows };
}

async function getActivityHistory(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, p: Record<string, unknown>): Promise<ReadResponse> {
  const limit = typeof p.limit === 'number' ? Math.min(p.limit, 100) : 20;
  const res = await db.query(
    `SELECT * FROM activity
     WHERE contact_id = $1 AND tenant_id = $2
     ORDER BY occurred_at DESC
     LIMIT $3`,
    [p.contactId, tenantId, limit],
  );
  return { ok: true, result: res.rows };
}

async function getEnrichmentData(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, p: Record<string, unknown>): Promise<ReadResponse> {
  const res = await db.query(
    `SELECT enrichment_json FROM contact WHERE id = $1 AND tenant_id = $2`,
    [p.contactId, tenantId],
  );
  if (res.rowCount === 0) return { ok: true, result: null };
  return { ok: true, result: res.rows[0].enrichment_json };
}

async function getBrandVoiceProfile(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, _p: Record<string, unknown>): Promise<ReadResponse> {
  const res = await db.query(
    `SELECT config->'brand_voice_profile' AS brand_voice_profile FROM tenant WHERE id = $1`,
    [tenantId],
  );
  if (res.rowCount === 0) return { ok: true, result: null };
  return { ok: true, result: res.rows[0].brand_voice_profile };
}

async function getActiveCampaigns(db: Awaited<ReturnType<typeof getDb>>, tenantId: string, _p: Record<string, unknown>): Promise<ReadResponse> {
  const res = await db.query(
    `SELECT * FROM campaign WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC`,
    [tenantId],
  );
  return { ok: true, result: res.rows };
}

// ── Entry point (API Gateway + direct Lambda invocation from agents) ──────────

export const handler: Handler<
  { operation: Operation; payload: Record<string, unknown>; tenantId?: string }
  | Parameters<APIGatewayProxyHandlerV2>[0],
  ReadResponse | { statusCode: number; body: string }
> = async (event) => {
  let tenantId: string | null = null;
  let req: ReadRequest;

  if ('requestContext' in event) {
    // API Gateway path
    const apigwEvent = event as Parameters<APIGatewayProxyHandlerV2>[0];
    tenantId = tenantFromEvent(apigwEvent);
    if (!tenantId) return { statusCode: 401, body: JSON.stringify({ error: 'Missing tenant_id' }) };
    req = JSON.parse(apigwEvent.body ?? '{}') as ReadRequest;
  } else {
    // Direct agent invocation path
    const directEvent = event as { operation: Operation; payload: Record<string, unknown>; tenantId: string };
    tenantId = directEvent.tenantId;
    req = { operation: directEvent.operation, payload: directEvent.payload };
  }

  if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: 'tenantId is required' }) };

  const { operation, payload } = req;

  try {
    const db = await getDb();

    switch (operation) {
      case 'get_contact':
        return getContact(db, tenantId, payload);

      case 'get_account':
        return getAccount(db, tenantId, payload);

      case 'list_contacts_for_campaign':
        return listContactsForCampaign(db, tenantId, payload);

      case 'get_activity_history':
        return getActivityHistory(db, tenantId, payload);

      case 'get_enrichment_data':
        return getEnrichmentData(db, tenantId, payload);

      case 'get_brand_voice_profile':
        return getBrandVoiceProfile(db, tenantId, payload);

      case 'get_active_campaigns':
        return getActiveCampaigns(db, tenantId, payload);

      // ── Phase 3 operations ────────────────────────────────────────────────

      case 'get_tenant': {
        // Returns full tenant record including tier — used by metering quota check
        const r = await db.query(
          `SELECT id, name, subdomain, tier, config FROM tenant WHERE id = $1`,
          [tenantId],
        );
        return { result: r.rows[0] ?? null };
      }

      case 'get_pipeline_data': {
        // Returns all open deals with their stages, amounts, and last activity date
        // Used by the Forecasting agent for pipeline forecast calculation
        const lookbackDays = (payload.lookbackDays as number) ?? 90;
        const r = await db.query(
          `SELECT d.id, d.name, d.stage, d.amount, d.probability, d.close_date,
                  d.created_at, d.updated_at,
                  MAX(a.occurred_at) AS last_activity_at,
                  COUNT(a.id)        AS activity_count
           FROM   deal d
           LEFT   JOIN activity a ON a.deal_id = d.id AND a.tenant_id = $1
           WHERE  d.tenant_id = $1
             AND  d.stage != 'Closed Won'
             AND  d.created_at >= NOW() - INTERVAL '${lookbackDays} days'
           GROUP  BY d.id
           ORDER  BY d.amount DESC`,
          [tenantId],
        );
        return { result: r.rows };
      }

      case 'get_deal_activity_ages': {
        // Returns days-in-current-stage per deal for anomaly detection
        // "Acme Corp deal has gone quiet 9 days against this team's 5-day median"
        const r = await db.query(
          `SELECT d.id, d.name, d.stage, d.amount,
                  EXTRACT(EPOCH FROM (NOW() - d.updated_at)) / 86400 AS days_in_stage,
                  EXTRACT(EPOCH FROM (NOW() - MAX(a.occurred_at))) / 86400 AS days_since_activity
           FROM   deal d
           LEFT   JOIN activity a ON a.deal_id = d.id AND a.tenant_id = $1
           WHERE  d.tenant_id = $1
             AND  d.stage NOT IN ('Closed Won', 'Prospecting')
           GROUP  BY d.id
           ORDER  BY days_since_activity DESC NULLS LAST`,
          [tenantId],
        );
        return { result: r.rows };
      }

      case 'get_registry': {
        // Returns agent/tool/template catalog — used by RegistryPage
        const typeFilter = payload.entryType as string | undefined;
        const r = await db.query(
          `SELECT entry_type, key, name, description, version, capabilities,
                  phase_introduced, status, metadata
           FROM   agent_registry
           WHERE  ($1::text IS NULL OR entry_type = $1)
             AND  status = 'active'
           ORDER  BY entry_type, phase_introduced, key`,
          [typeFilter ?? null],
        );
        return { result: r.rows };
      }

      case 'get_a2a_agent_card': {
        const r = await db.query(
          `SELECT * FROM agent_registry WHERE key = $1 AND entry_type = 'agent'`,
          [payload.key],
        );
        return { result: r.rows[0] ?? null };
      }

      // ── Phase 7 / 8 support operations ─────────────────────────────────────

      case 'get_conversation': {
        const r = await db.query(
          `SELECT * FROM conversation WHERE id = $1 AND tenant_id = $2`,
          [payload.id, tenantId],
        );
        return { result: r.rows[0] ?? null };
      }

      case 'get_messages': {
        const r = await db.query(
          `SELECT * FROM message WHERE conversation_id = $1 AND tenant_id = $2
           ORDER BY created_at DESC LIMIT $3`,
          [payload.conversationId, tenantId, payload.limit ?? 20],
        );
        return { result: r.rows };
      }

      case 'get_support_queue': {
        const r = await db.query(
          `SELECT * FROM support_queue WHERE id = $1 AND tenant_id = $2`,
          [payload.id, tenantId],
        );
        return { result: r.rows[0] ?? null };
      }

      case 'get_sla_policy': {
        const r = await db.query(
          `SELECT * FROM sla_policy WHERE id = $1 AND tenant_id = $2`,
          [payload.id, tenantId],
        );
        return { result: r.rows[0] ?? null };
      }

      case 'list_queues': {
        const skill = payload.requiredSkill as string | undefined;
        const r = await db.query(
          `SELECT * FROM support_queue WHERE tenant_id = $1
           ${skill ? `AND required_skills::text ILIKE '%${skill.replace(/'/g, "''")}%'` : ''}
           ORDER BY name`,
          [tenantId],
        );
        return { result: r.rows };
      }

      case 'list_available_reps': {
        const r = await db.query(
          `SELECT rep_id, concurrent_ticket_count
           FROM   rep_status
           WHERE  tenant_id = $1 AND status = 'available'
           ORDER  BY concurrent_ticket_count ASC
           LIMIT  10`,
          [tenantId],
        );
        return { result: r.rows };
      }

      case 'count_prior_tickets': {
        const r = await db.query(
          `SELECT COUNT(*) AS count
           FROM   ticket t
           JOIN   conversation c ON c.id = t.conversation_id
           WHERE  c.contact_id = $1 AND c.tenant_id = $2
             AND  t.created_at >= NOW() - INTERVAL '${Number(payload.daysSince ?? 30)} days'
             AND  c.status != 'resolved'`,
          [payload.contactId, tenantId],
        );
        return { count: Number(r.rows[0]?.count ?? 0) };
      }

      case 'get_support_metrics': {
        // Phase 9A: raw data for Support Insight Agent
        const days = Number(payload.periodDays ?? 30);
        const [ticketsR, convsR] = await Promise.all([
          db.query(
            `SELECT t.id, t.tier, t.priority, t.sla_target_at, t.sla_breached_at,
                    t.created_at, t.updated_at, sq.name AS queue_name,
                    c.status, c.csat_score, c.first_response_at,
                    c.created_at AS conv_created, c.resolved_at
             FROM   ticket t
             JOIN   conversation c  ON c.id = t.conversation_id
             LEFT   JOIN support_queue sq ON sq.id = t.queue_id
             WHERE  t.tenant_id = $1
               AND  t.created_at >= NOW() - INTERVAL '${days} days'`,
            [tenantId],
          ),
          db.query(
            `SELECT id, status, created_at, first_response_at,
                    resolved_at, csat_score, channel_history
             FROM   conversation
             WHERE  tenant_id = $1
               AND  created_at >= NOW() - INTERVAL '${days} days'`,
            [tenantId],
          ),
        ]);
        return { result: { tickets: ticketsR.rows, conversations: convsR.rows } };
      }

      case 'get_support_signals_for_contact': {
        // Phase 9D: support signals for renewal-risk scoring
        const r = await db.query(
          `SELECT t.tier, t.priority, t.sla_breached_at, t.created_at,
                  sq.name AS queue_name, c.csat_score, c.status
           FROM   ticket t
           JOIN   conversation c  ON c.id = t.conversation_id
           LEFT   JOIN support_queue sq ON sq.id = t.queue_id
           WHERE  c.contact_id = $1 AND t.tenant_id = $2
           ORDER  BY t.created_at DESC
           LIMIT  $3`,
          [payload.contactId, tenantId, payload.limit ?? 20],
        );
        return { result: r.rows };
      }

      case 'search_knowledge_articles': {
        // Phase 8A: KB search for Resolution Agent (keyword fallback; S3 Vectors in production)
        const query = (payload.query as string ?? '').replace(/'/g, "''");
        const r     = await db.query(
          `SELECT id, title, body, status, version, last_reviewed_at, tags
           FROM   knowledge_article
           WHERE  tenant_id = $1
             AND  status = COALESCE($2, 'published')
             AND  (title ILIKE $3 OR body ILIKE $3)
           ORDER  BY last_reviewed_at DESC NULLS LAST
           LIMIT  $4`,
          [tenantId, payload.status ?? 'published', `%${query}%`, payload.limit ?? 5],
        );
        return { result: r.rows };
      }

      case 'get_knowledge_article': {
        const r = await db.query(
          `SELECT * FROM knowledge_article WHERE id = $1 AND tenant_id = $2`,
          [payload.id, tenantId],
        );
        return { result: r.rows[0] ?? null };
      }

      case 'get_macros': {
        const r = await db.query(
          `SELECT id, title, body_template, tags, usage_count
           FROM   macro WHERE tenant_id = $1
           ORDER  BY usage_count DESC LIMIT $2`,
          [tenantId, payload.limit ?? 20],
        );
        return { result: r.rows };
      }

      case 'get_workspace_templates': {
        // Returns all workspace template activations for this tenant
        const r = await db.query(
          `SELECT id, template_key, name, status, config,
                  legal_reviewed_by, legal_reviewed_at, created_at, updated_at
           FROM   workspace_template
           WHERE  tenant_id = $1
           ORDER  BY created_at DESC`,
          [tenantId],
        );
        return { result: r.rows };
      }

      case 'scan_for_duplicates': {
        // Returns contact pairs with high name/email similarity for hygiene agent
        // Deterministic fuzzy match using trigram similarity (pg_trgm not available in DSQL)
        // Fallback: exact email domain + similar first/last name via LIKE
        const entityType = (payload.entityType as string) ?? 'contact';
        if (entityType === 'contact') {
          const r = await db.query(
            `SELECT a.id AS id_a, a.first_name || ' ' || a.last_name AS name_a, a.email AS email_a,
                    b.id AS id_b, b.first_name || ' ' || b.last_name AS name_b, b.email AS email_b
             FROM   contact a
             JOIN   contact b ON a.tenant_id = b.tenant_id AND a.id < b.id
             WHERE  a.tenant_id = $1
               AND  (
                     -- Same email → definite duplicate
                     (a.email IS NOT NULL AND a.email = b.email)
                     -- Same first+last name (case-insensitive)
                  OR (LOWER(a.first_name) = LOWER(b.first_name)
                      AND LOWER(a.last_name) = LOWER(b.last_name))
               )
             LIMIT  50`,
            [tenantId],
          );
          return { result: r.rows };
        }
        return { result: [] };
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown operation: ${operation}` }) };
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.error('CRM read error', { operation, error: msg });
    return { ok: false, error: msg };
  }
};
