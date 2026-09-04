/**
 * CRM Read Service — read-only queries against Aurora DSQL.
 *
 * All agents READ contact/account/activity data through this Lambda.
 * This Lambda NEVER writes to DSQL — all writes go through crm-write-service.
 *
 * Tenant isolation: every query includes a tenant_id parameter.
 * Supports both API Gateway and direct Lambda invocation from agents.
 */
import type { APIGatewayProxyEvent, Handler } from 'aws-lambda';
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
  // ── UI list operations ──────────────────────────────────────────────────────
  // The agents only ever fetch one record at a time, so the SPA had nothing to
  // call for its table views. These are paginated deliberately: a tenant's
  // contact list is unbounded and the browser must not pull all of it.
  | 'list_contacts'
  | 'list_agent_runs'
  | 'list_deals'
  | 'list_campaigns'
  | 'get_dashboard_stats'
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

// The API uses a COGNITO_USER_POOLS authorizer, which puts the verified ID-token
// claims at requestContext.authorizer.claims as a FLAT map of strings.
// Three shapes exist and only one is right here:
//   REST + Cognito authorizer  -> authorizer.claims['custom:tenant_id']  <-- this
//   REST + custom authorizer   -> authorizer.tenantId       (flat context)
//   HTTP API (v2) + JWT        -> authorizer.jwt.claims[...]
// Reading the wrong one yields undefined and every request 401s.
function tenantFromEvent(event: APIGatewayProxyEvent): string | null {
  const claims = event.requestContext?.authorizer?.claims as
    | Record<string, string>
    | undefined;
  return claims?.['custom:tenant_id'] ?? null;
}

// ── Layer 2 of tenant isolation ──────────────────────────────────────────────
// x-impulsoiq-tenant carries the workspace the caller believes it is talking
// to; custom:tenant_id is the workspace their signed token actually belongs
// to. They agree for a legitimate request.
//
// HOW FAR TO TRUST THE HEADER
// The SPA sets it from window.location.hostname, so it is CLIENT-SUPPLIED. The
// CloudFront function stamps the same header, but only on requests that
// traverse the distribution — the SPA calls API Gateway directly, so today
// that stamping applies to document requests, not API calls. Routing /api/*
// through the same distribution would make the header origin-trusted; until
// then it is not.
//
// That is fine for what this check is for. It cannot be used to READ another
// tenant: every query below is scoped by the CLAIM, so forging the header only
// makes your own request 403. What it prevents is the honest failure mode.
//
// WHY THIS MATTERS
// Every query below is already scoped by the CLAIM, so a mismatch cannot leak
// another tenant's rows. What it would do without this check is quietly serve
// tenant A's data on tenant B's address: a user who follows a link to
// b.impulsoiq... while signed in to A sees their OWN workspace under B's
// branding and URL. That is a correctness and trust failure, and it is exactly
// the case a URL-based workspace model has to get right.
//
// The header is absent for direct agent invocation and for requests that did
// not pass through CloudFront (calling the API Gateway URL straight). Absent
// means "no host to check", so the claim stands alone — this is a
// cross-check, not the boundary.
function assertTenantMatchesHost(event: APIGatewayProxyEvent, tenantId: string): string | null {
  const headers = event.headers ?? {};
  // Header names are case-insensitive; API Gateway does not normalise them.
  let host = '';
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'x-impulsoiq-tenant') {
      host = (headers[k] ?? '').trim();
      break;
    }
  }
  if (!host) return null;          // no host context — claim is authoritative
  if (host === tenantId) return null;
  return `Tenant mismatch: signed in as '${tenantId}' but requested '${host}'`;
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

const dispatch: Handler<
  { operation: Operation; payload: Record<string, unknown>; tenantId?: string }
  | APIGatewayProxyEvent,
  unknown
> = async (event) => {
  let tenantId: string | null = null;
  let req: ReadRequest;

  if ('requestContext' in event) {
    // API Gateway path
    const apigwEvent = event as APIGatewayProxyEvent;
    tenantId = tenantFromEvent(apigwEvent);
    if (!tenantId) return { statusCode: 401, body: JSON.stringify({ error: 'Missing tenant_id' }) };

    const mismatch = assertTenantMatchesHost(apigwEvent, tenantId);
    if (mismatch) return { statusCode: 403, body: JSON.stringify({ error: mismatch }) };
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

      // ── UI list operations ───────────────────────────────────────────────

      case 'list_contacts': {
        const page = Math.max(1, Number(payload.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Number(payload.pageSize ?? 20)));
        const search = String(payload.search ?? '').trim();

        // Search terms go in as a PARAMETER, never interpolated into the SQL.
        const params: unknown[] = [tenantId];
        let where = 'WHERE c.tenant_id = $1';
        if (search) {
          params.push(`%${search}%`);
          where += ` AND (c.first_name ILIKE $2 OR c.last_name ILIKE $2 OR c.email ILIKE $2)`;
        }

        const countRes = await db.query(
          `SELECT COUNT(*)::int AS total FROM contact c ${where}`,
          params,
        );

        // account_name and last_activity_at are joined, not stored: the UI shows
        // a company column and a "last touched" column, and without these the
        // table could only render a name and an email.
        const rows = await db.query(
          `SELECT c.*,
                  acc.name           AS account_name,
                  MAX(a.occurred_at) AS last_activity_at
           FROM   contact c
           LEFT   JOIN account  acc ON acc.id = c.account_id AND acc.tenant_id = c.tenant_id
           LEFT   JOIN activity a   ON a.contact_id = c.id   AND a.tenant_id  = c.tenant_id
           ${where}
           GROUP  BY c.id, acc.name
           ORDER  BY c.updated_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, pageSize, (page - 1) * pageSize],
        );

        return { result: { items: rows.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize } };
      }

      case 'list_campaigns': {
        // Campaign metrics are AGGREGATES, not columns. activity has no
        // campaign_id, so the path is campaign -> agent_run -> activity /
        // call_result.
        //
        // There is deliberately no open_rate or reply_rate here: activity.type
        // is email|sms|call|note|task|meeting, and nothing in the schema records
        // an email being opened or replied to. Returning a computed-looking
        // number for those would be inventing data.
        //
        // COUNT(DISTINCT CASE ...) rather than FILTER, which keeps this portable
        // across the Postgres subset Aurora DSQL implements.
        const r = await db.query(
          `SELECT c.*,
                  COUNT(DISTINCT ar.contact_id)                                   AS contacts_total,
                  COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN a.contact_id END) AS contacts_touched,
                  COUNT(DISTINCT cr.id)                                            AS calls_made,
                  COUNT(DISTINCT CASE WHEN a.type = 'meeting' THEN a.id END)       AS meetings_booked,
                  COUNT(DISTINCT ar.id)                                            AS agent_runs
           FROM   campaign c
           LEFT   JOIN agent_run   ar ON ar.campaign_id  = c.id  AND ar.tenant_id = c.tenant_id
           LEFT   JOIN activity    a  ON a.agent_run_id  = ar.id AND a.tenant_id  = c.tenant_id
           LEFT   JOIN call_result cr ON cr.agent_run_id = ar.id AND cr.tenant_id = c.tenant_id
           WHERE  c.tenant_id = $1
           GROUP  BY c.id
           ORDER  BY c.created_at DESC`,
          [tenantId],
        );
        return { result: r.rows };
      }

      case 'list_deals': {
        const page = Math.max(1, Number(payload.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Number(payload.pageSize ?? 50)));

        // Distinct from get_pipeline_data, which is the FORECASTING view: that
        // one excludes Closed Won and only looks back N days. A deals table
        // must show every deal, including the won ones.
        const countRes = await db.query(
          `SELECT COUNT(*)::int AS total FROM deal WHERE tenant_id = $1`, [tenantId]);
        const rows = await db.query(
          `SELECT d.*, acc.name AS account_name
           FROM   deal d
           LEFT   JOIN account acc ON acc.id = d.account_id AND acc.tenant_id = d.tenant_id
           WHERE  d.tenant_id = $1
           ORDER  BY d.amount DESC
           LIMIT $2 OFFSET $3`,
          [tenantId, pageSize, (page - 1) * pageSize],
        );
        return {
          result: {
            items: rows.rows,
            total: countRes.rows[0]?.total ?? 0,
            page,
            pageSize,
          },
        };
      }

      case 'list_agent_runs': {
        const page = Math.max(1, Number(payload.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Number(payload.pageSize ?? 20)));

        const countRes = await db.query(
          `SELECT COUNT(*)::int AS total FROM agent_run WHERE tenant_id = $1`,
          [tenantId],
        );
        const rows = await db.query(
          `SELECT ar.*, c.first_name, c.last_name
           FROM   agent_run ar
           LEFT JOIN contact c ON c.id = ar.contact_id AND c.tenant_id = ar.tenant_id
           WHERE  ar.tenant_id = $1
           ORDER BY ar.started_at DESC
           LIMIT $2 OFFSET $3`,
          [tenantId, pageSize, (page - 1) * pageSize],
        );
        return {
          result: {
            items: rows.rows,
            total: countRes.rows[0]?.total ?? 0,
            page,
            pageSize,
          },
        };
      }

      case 'get_dashboard_stats': {
        // One statement, not five. Each sub-select is tenant-scoped; a missing
        // tenant_id predicate anywhere here would leak across tenants.
        const r = await db.query(
          `SELECT
             (SELECT COUNT(*)::int FROM contact   WHERE tenant_id = $1) AS total_contacts,
             (SELECT COUNT(*)::int FROM campaign  WHERE tenant_id = $1
                AND status = 'active')                                  AS active_campaigns,
             (SELECT COUNT(*)::int FROM agent_run WHERE tenant_id = $1
                AND status = 'running')                                 AS running_agents,
             (SELECT COUNT(*)::int FROM deal      WHERE tenant_id = $1)  AS total_deals,
             (SELECT COALESCE(SUM(amount), 0)::float FROM deal
                WHERE tenant_id = $1)                                    AS pipeline_value`,
          [tenantId],
        );
        return { result: r.rows[0] ?? {} };
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

// ── API Gateway proxy boundary ───────────────────────────────────────────────
// A Lambda PROXY integration requires {statusCode, headers, body}. Most
// operations below return a bare {result: ...}; returned as-is through the
// proxy that yields a 502 "Internal server error" with nothing in the log to
// explain it. So dispatch() keeps its natural return shape and the exported
// handler adapts it at the boundary -- and only when the caller was API
// Gateway. Agents invoke these same functions directly and must keep getting
// the raw object.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-impulsoiq-tenant',
  'Content-Type': 'application/json',
};

function toProxyResponse(out: unknown) {
  // An early return that already built a proxy response passes straight through.
  if (out && typeof out === 'object' && 'statusCode' in (out as object)) {
    const r = out as { statusCode: number; body?: string; headers?: Record<string, string> };
    return { ...r, headers: { ...CORS_HEADERS, ...r.headers } };
  }
  const failed = !!(out && typeof out === 'object' && (out as { ok?: boolean }).ok === false);
  return {
    statusCode: failed ? 500 : 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(out ?? null),
  };
}

export const handler: Handler<
  { operation: Operation; payload: Record<string, unknown>; tenantId?: string }
  | APIGatewayProxyEvent,
  unknown
> = async (event, context, callback) => {
  const viaApiGateway = !!event && typeof event === 'object' && 'requestContext' in event;
  const out = await dispatch(event, context, callback);
  return viaApiGateway ? toProxyResponse(out) : out;
};
