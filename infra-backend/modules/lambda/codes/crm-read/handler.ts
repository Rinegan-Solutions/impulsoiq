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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDb } from './db';

const metering = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});

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
  | 'list_accounts'
  | 'list_activities'
  | 'list_pending_approvals'
  | 'get_activity'
  | 'list_agent_runs'
  | 'get_agent_run'
  | 'list_active_agent_runs'
  | 'get_metering_usage'
  | 'get_hitl_status'
  | 'list_deals'
  | 'list_campaigns'
  | 'get_dashboard_stats'
  | 'get_campaign'
  | 'list_enrichment_records'
  | 'list_decayed_enrichment'
  | 'list_sequences'
  | 'get_sequence'
  | 'get_email_verification'
  | 'get_outbound_quality'
  | 'get_campaign_usage'
  | 'list_invitations'
  | 'find_invitation'
  | 'list_threads'
  | 'get_thread'       // direct invocation only (token lookup)
  | 'export_dsar'
  | 'export_audit'
  | 'get_channel_efficacy'
  | 'get_pipeline_attribution'
  | 'get_forecast_report'
  | 'get_personal_queue'
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


// ── Workspace membership ─────────────────────────────────────────────────────
// custom:tenant_id records the workspace an account ASKED for at sign-up — the
// browser chose it. Membership is granted only by tenant-provisioner, which adds
// the account to a Cognito group after checking it may join (it created the
// workspace, or it claimed a valid invitation). An account whose
// provisioning failed or was refused has the claim but no group, and must reach
// no data at all.
/** The Cognito sub of the signed-in caller. Home threads are scoped to it. */
function subOf(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  return String(claims?.sub ?? '');
}

const WORKSPACE_ROLES = new Set(['admin', 'manager', 'member']);

function hasWorkspaceRole(event: APIGatewayProxyEvent): boolean {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  const raw = claims?.['cognito:groups'];
  if (raw == null) return false;
  // The REST Cognito authorizer flattens claims to strings, so a groups array
  // can arrive bracketed and space- or comma-separated. Tokenise rather than
  // JSON.parse, and accept a real array too.
  const values = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[\s,[\]"]+/);
  return values.some((g) => WORKSPACE_ROLES.has(g));
}

/**
 * Data-subject and audit reads are administrative actions.
 *
 * crm-write already restricts erase_dsar to admins and managers; the matching
 * READ paths (export_dsar, export_audit) had no role check, so any member could
 * pull a contact's full consent/call history or the whole workspace audit log.
 * Enterprise settings tells customers these are admin tools — this makes that true.
 */
function isManagerOrAdmin(event: APIGatewayProxyEvent): boolean {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  const raw = claims?.['cognito:groups'];
  if (raw == null) return false;
  const values = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[\s,[\]"]+/);
  return values.some((g) => g === 'admin' || g === 'manager');
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
    `SELECT c.*, acc.name AS account_name
     FROM contact c
     LEFT JOIN account acc ON acc.id = c.account_id AND acc.tenant_id = c.tenant_id
     WHERE c.id = $1 AND c.tenant_id = $2`,
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
  const blob = await db.query(
    `SELECT enrichment_json FROM contact WHERE id = $1 AND tenant_id = $2`,
    [p.contactId, tenantId],
  );
  const records = await db.query(
    `SELECT source, field, value, confidence, fetched_at, decay_policy, metadata
     FROM enrichment_record
     WHERE tenant_id = $1 AND contact_id = $2
     ORDER BY fetched_at DESC
     LIMIT 80`,
    [tenantId, p.contactId],
  );
  const latestEmail = records.rows.find((r) => r.field === 'email' || r.field === 'email_verified');
  return {
    ok: true,
    result: {
      enrichment_json: blob.rows[0]?.enrichment_json ?? {},
      records: records.rows,
      verifiedEmail: isVerifiedEmailRow(latestEmail),
    },
  };
}

function isVerifiedEmailRow(row: { field?: string; confidence?: number | string; metadata?: Record<string, unknown>; fetched_at?: string; decay_policy?: string } | undefined): boolean {
  if (!row) return false;
  const conf = Number(row.confidence ?? 0);
  if (conf < 0.8) return false;
  const meta = row.metadata ?? {};
  const status = String(meta.status ?? meta.verificationStatus ?? '');
  if (status && !['verified', 'valid', 'deliverable'].includes(status)) return false;
  if (row.field === 'email' && status === '') return false;
  return !isDecayed(row.fetched_at, row.decay_policy ?? '30d');
}

function isDecayed(fetchedAt: string | undefined, policy: string): boolean {
  if (!fetchedAt) return true;
  const days = policy.endsWith('d') ? Number(policy.slice(0, -1)) : 90;
  if (!Number.isFinite(days) || days <= 0) return false;
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return ageMs > days * 86400_000;
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
    if (!hasWorkspaceRole(apigwEvent)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This account has not been granted access to its workspace' }) };
    }

    const mismatch = assertTenantMatchesHost(apigwEvent, tenantId);
    if (mismatch) return { statusCode: 403, body: JSON.stringify({ error: mismatch }) };
    req = JSON.parse(apigwEvent.body ?? '{}') as ReadRequest;
    const claims = apigwEvent.requestContext?.authorizer?.claims as Record<string, string> | undefined;
    const actorId = claims?.sub ?? claims?.email ?? '';
    req.payload = { ...(req.payload ?? {}), _actorId: actorId };
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
          `SELECT id, name, subdomain, email_domain, tier, config FROM tenant WHERE id = $1`,
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
          `SELECT d.id, d.name, d.stage, d.amount, d.contact_id,
                  EXTRACT(EPOCH FROM (NOW() - d.updated_at)) / 86400 AS days_in_stage,
                  EXTRACT(EPOCH FROM (NOW() - MAX(a.occurred_at))) / 86400 AS days_since_activity
           FROM   deal d
           LEFT   JOIN activity a ON a.deal_id = d.id AND a.tenant_id = $1
           WHERE  d.tenant_id = $1
             AND  d.stage NOT IN ('Closed Won', 'Prospecting')
           GROUP  BY d.id, d.name, d.stage, d.amount, d.contact_id
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
        const stage = String(payload.stage ?? '').trim();

        const params: unknown[] = [tenantId];
        let where = 'WHERE c.tenant_id = $1';
        if (search) {
          params.push(`%${search}%`);
          where += ` AND (c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`;
        }
        if (stage) {
          params.push(stage);
          where += ` AND c.stage = $${params.length}`;
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

      case 'list_accounts': {
        const page = Math.max(1, Number(payload.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Number(payload.pageSize ?? 20)));
        const search = String(payload.search ?? '').trim();
        const params: unknown[] = [tenantId];
        let where = 'WHERE a.tenant_id = $1';
        if (search) {
          params.push(`%${search}%`);
          where += ` AND (a.name ILIKE $${params.length} OR a.domain ILIKE $${params.length} OR COALESCE(a.industry,'') ILIKE $${params.length})`;
        }
        const countRes = await db.query(
          `SELECT COUNT(*)::int AS total FROM account a ${where}`,
          params,
        );
        const rows = await db.query(
          `SELECT a.*,
                  (SELECT COUNT(*)::int FROM contact c WHERE c.account_id = a.id AND c.tenant_id = a.tenant_id) AS contact_count,
                  (SELECT COUNT(*)::int FROM deal d WHERE d.account_id = a.id AND d.tenant_id = a.tenant_id) AS deal_count,
                  (SELECT COALESCE(SUM(d.amount), 0) FROM deal d
                     WHERE d.account_id = a.id AND d.tenant_id = a.tenant_id
                       AND d.stage <> 'Closed Won') AS pipeline,
                  (SELECT MAX(act.occurred_at) FROM activity act
                     WHERE act.tenant_id = a.tenant_id
                       AND (act.account_id = a.id OR act.contact_id IN (
                         SELECT c.id FROM contact c WHERE c.account_id = a.id AND c.tenant_id = a.tenant_id
                       ))) AS last_activity_at
           FROM account a
           ${where}
           ORDER BY a.updated_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, pageSize, (page - 1) * pageSize],
        );
        return { result: { items: rows.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize } };
      }

      case 'list_activities': {
        const page = Math.max(1, Number(payload.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Number(payload.pageSize ?? 40)));
        const contactId = String(payload.contactId ?? '').trim();
        const accountId = String(payload.accountId ?? '').trim();
        const params: unknown[] = [tenantId];
        let where = 'WHERE a.tenant_id = $1';
        if (contactId) {
          params.push(contactId);
          where += ` AND a.contact_id = $${params.length}`;
        }
        if (accountId) {
          params.push(accountId);
          where += ` AND (a.account_id = $${params.length} OR a.contact_id IN (SELECT id FROM contact WHERE account_id = $${params.length} AND tenant_id = $1))`;
        }
        const countRes = await db.query(
          `SELECT COUNT(*)::int AS total FROM activity a ${where}`,
          params,
        );
        const rows = await db.query(
          `SELECT a.*, c.first_name, c.last_name, c.email,
                  acc.name AS account_name
           FROM activity a
           LEFT JOIN contact c ON c.id = a.contact_id AND c.tenant_id = a.tenant_id
           LEFT JOIN account acc ON acc.id = COALESCE(a.account_id, c.account_id) AND acc.tenant_id = a.tenant_id
           ${where}
           ORDER BY a.occurred_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, pageSize, (page - 1) * pageSize],
        );
        return { result: { items: rows.rows, total: countRes.rows[0]?.total ?? 0, page, pageSize } };
      }

      case 'list_pending_approvals': {
        const rows = await db.query(
          `SELECT a.*, c.first_name, c.last_name, c.email, c.account_id,
                  acc.name AS account_name
           FROM activity a
           LEFT JOIN contact c ON c.id = a.contact_id AND c.tenant_id = a.tenant_id
           LEFT JOIN account acc ON acc.id = COALESCE(a.account_id, c.account_id) AND acc.tenant_id = a.tenant_id
           WHERE a.tenant_id = $1
             AND a.metadata->>'status' = 'awaiting_approval'
           ORDER BY a.occurred_at DESC
           LIMIT 100`,
          [tenantId],
        );
        return { result: rows.rows };
      }

      case 'get_activity': {
        const rows = await db.query(
          `SELECT a.*, c.first_name, c.last_name, c.email, acc.name AS account_name
           FROM activity a
           LEFT JOIN contact c ON c.id = a.contact_id AND c.tenant_id = a.tenant_id
           LEFT JOIN account acc ON acc.id = COALESCE(a.account_id, c.account_id) AND acc.tenant_id = a.tenant_id
           WHERE a.tenant_id = $1 AND a.id = $2
           LIMIT 1`,
          [tenantId, payload.id],
        );
        return { result: rows.rows[0] ?? null };
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

      case 'get_agent_run': {
        const rows = await db.query(
          `SELECT ar.*, c.first_name, c.last_name
           FROM   agent_run ar
           LEFT JOIN contact c ON c.id = ar.contact_id AND c.tenant_id = ar.tenant_id
           WHERE  ar.tenant_id = $1 AND ar.id = $2
           LIMIT 1`,
          [tenantId, payload.id],
        );
        return { result: rows.rows[0] ?? null };
      }

      case 'list_active_agent_runs': {
        const rows = await db.query(
          `SELECT ar.*, c.first_name, c.last_name
           FROM   agent_run ar
           LEFT JOIN contact c ON c.id = ar.contact_id AND c.tenant_id = ar.tenant_id
           WHERE  ar.tenant_id = $1
             AND  ar.status IN ('running','paused','pending')
           ORDER BY ar.started_at DESC`,
          [tenantId],
        );
        return { result: rows.rows };
      }

      case 'get_metering_usage': {
        const table = process.env.METERING_TABLE;
        if (!table) {
          return { result: { period: null, items: [], error: 'METERING_TABLE is not configured' } };
        }
        const period = typeof payload.period === 'string' && payload.period
          ? payload.period
          : new Date().toISOString().slice(0, 7);
        const res = await metering.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': `${tenantId}#meter#${period}` },
        }));
        return {
          result: {
            period,
            items: (res.Items ?? []).map((item) => ({
              resource: item.sk,
              used: Number(item.count ?? 0),
              quota: Number(item.quota ?? 0),
            })),
          },
        };
      }

      case 'get_hitl_status': {
        const tenant = await db.query(
          `SELECT tier, config FROM tenant WHERE id = $1`,
          [tenantId],
        );
        const config = (tenant.rows[0]?.config ?? {}) as Record<string, unknown>;
        const tier = String(tenant.rows[0]?.tier ?? 'free');
        const counts = await db.query(
          `SELECT
             COUNT(*) FILTER (WHERE type = 'email' AND actor_type = 'agent'
               AND COALESCE(metadata->>'status','') <> 'awaiting_approval')::int AS email_sends,
             COUNT(*) FILTER (WHERE type = 'call' AND actor_type = 'agent')::int AS calls
           FROM activity WHERE tenant_id = $1`,
          [tenantId],
        );
        const emailSends = counts.rows[0]?.email_sends ?? 0;
        const calls = counts.rows[0]?.calls ?? 0;
        const loosened = config.hitlRelaxed === true;
        const requiresApproval = tier === 'free'
          ? true
          : (loosened ? false : (emailSends < 20 || calls < 5));
        return {
          result: {
            emailSends,
            calls,
            firstNSends: 20,
            firstNCalls: 5,
            hitlRelaxed: loosened,
            requiresApproval,
            voiceAllowed: tier !== 'free',
            tier,
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

      case 'get_campaign': {
        const r = await db.query(`SELECT * FROM campaign WHERE id = $1 AND tenant_id = $2`, [payload.id, tenantId]);
        return { result: r.rows[0] ?? null };
      }

      case 'list_enrichment_records': {
        const r = await db.query(
          `SELECT * FROM enrichment_record
           WHERE tenant_id = $1 AND contact_id = $2
           ORDER BY fetched_at DESC
           LIMIT 100`,
          [tenantId, payload.contactId],
        );
        return { result: r.rows };
      }

      case 'list_decayed_enrichment': {
        const r = await db.query(
          `SELECT er.*, c.first_name, c.last_name, c.email
           FROM enrichment_record er
           JOIN contact c ON c.id = er.contact_id AND c.tenant_id = er.tenant_id
           WHERE er.tenant_id = $1
             AND er.fetched_at < NOW() - INTERVAL '90 days'
           ORDER BY er.fetched_at ASC
           LIMIT 200`,
          [tenantId],
        );
        return { result: r.rows };
      }

      case 'list_sequences': {
        const r = await db.query(
          `SELECT * FROM sequence WHERE tenant_id = $1 ORDER BY updated_at DESC`,
          [tenantId],
        );
        return { result: r.rows };
      }

      case 'get_sequence': {
        const r = await db.query(
          `SELECT * FROM sequence WHERE id = $1 AND tenant_id = $2`,
          [payload.id, tenantId],
        );
        return { result: r.rows[0] ?? null };
      }

      case 'get_email_verification': {
        const r = await db.query(
          `SELECT source, field, value, confidence, fetched_at, decay_policy, metadata
           FROM enrichment_record
           WHERE tenant_id = $1 AND contact_id = $2
             AND field IN ('email','email_verified')
           ORDER BY fetched_at DESC
           LIMIT 5`,
          [tenantId, payload.contactId],
        );
        const latest = r.rows[0] as { field?: string; confidence?: number; metadata?: Record<string, unknown>; fetched_at?: string; decay_policy?: string } | undefined;
        return {
          result: {
            verified: isVerifiedEmailRow(latest),
            records: r.rows,
          },
        };
      }

      case 'get_outbound_quality': {
        const consent = await db.query(
          `SELECT COUNT(*)::int AS n FROM activity
           WHERE tenant_id = $1 AND metadata->>'kind' = 'consent_block'`,
          [tenantId],
        );
        const bounce = await db.query(
          `SELECT COUNT(*)::int AS n FROM activity
           WHERE tenant_id = $1 AND metadata->>'kind' = 'bounce'`,
          [tenantId],
        );
        const calls = await db.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE outcome = 'answered')::int AS answered,
             COUNT(*) FILTER (WHERE schema_valid IS TRUE)::int AS schema_ok,
             COUNT(*) FILTER (WHERE schema_valid IS FALSE)::int AS schema_fail
           FROM call_result WHERE tenant_id = $1`,
          [tenantId],
        );
        const total = calls.rows[0]?.total ?? 0;
        const answered = calls.rows[0]?.answered ?? 0;
        const schemaOk = calls.rows[0]?.schema_ok ?? 0;
        return {
          result: {
            consentBlocks: consent.rows[0]?.n ?? 0,
            bounces: bounce.rows[0]?.n ?? 0,
            calls: total,
            answered,
            connectRate: total > 0 ? answered / total : null,
            schemaValidationPassRate: total > 0 ? schemaOk / total : null,
            schemaFailures: calls.rows[0]?.schema_fail ?? 0,
          },
        };
      }

      case 'get_campaign_usage': {
        const r = await db.query(
          `SELECT c.id, c.name,
                  COUNT(DISTINCT ar.id)::int AS runs,
                  COUNT(DISTINCT CASE WHEN a.type = 'email' THEN a.id END)::int AS emails,
                  COUNT(DISTINCT CASE WHEN a.metadata->>'kind' = 'consent_block' THEN a.id END)::int AS consent_blocks,
                  COUNT(DISTINCT CASE WHEN a.metadata->>'kind' = 'bounce' THEN a.id END)::int AS bounces,
                  COUNT(DISTINCT cr.id)::int AS calls,
                  COALESCE(SUM(cr.duration_seconds), 0)::int AS call_seconds
           FROM campaign c
           LEFT JOIN agent_run ar ON ar.campaign_id = c.id AND ar.tenant_id = c.tenant_id
           LEFT JOIN activity a ON a.agent_run_id = ar.id AND a.tenant_id = c.tenant_id
           LEFT JOIN call_result cr ON cr.agent_run_id = ar.id AND cr.tenant_id = c.tenant_id
           WHERE c.tenant_id = $1
           GROUP BY c.id
           ORDER BY c.created_at DESC`,
          [tenantId],
        );
        return { result: r.rows };
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

      case 'get_channel_efficacy': {
        const activity = await db.query(
          `SELECT type,
                  COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE actor_type = 'agent')::int AS agent,
                  COUNT(*) FILTER (WHERE actor_type = 'human')::int AS human
           FROM activity
           WHERE tenant_id = $1 AND type IN ('email','sms','call')
           GROUP BY type`,
          [tenantId],
        );
        const calls = await db.query(
          `SELECT outcome, COUNT(*)::int AS n
           FROM call_result WHERE tenant_id = $1
           GROUP BY outcome`,
          [tenantId],
        );
        return {
          result: {
            channels: activity.rows,
            callOutcomes: calls.rows,
            omitted: ['email_open', 'email_reply'],
            omittedReason: 'activity.type has no open or reply event. Those rates are not claimed.',
          },
        };
      }

      case 'get_pipeline_attribution': {
        const r = await db.query(
          `SELECT
             COALESCE(SUM(d.amount) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM activity a
                 WHERE a.deal_id = d.id AND a.tenant_id = d.tenant_id AND a.actor_type = 'agent'
               )
             ), 0)::float AS agent_sourced,
             COALESCE(SUM(d.amount) FILTER (
               WHERE NOT EXISTS (
                 SELECT 1 FROM activity a
                 WHERE a.deal_id = d.id AND a.tenant_id = d.tenant_id AND a.actor_type = 'agent'
               )
             ), 0)::float AS human_or_untouched,
             COUNT(*) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM activity a
                 WHERE a.deal_id = d.id AND a.tenant_id = d.tenant_id AND a.actor_type = 'agent'
               )
             )::int AS agent_sourced_deals,
             COUNT(*)::int AS deals
           FROM deal d WHERE d.tenant_id = $1 AND d.stage != 'Closed Won'`,
          [tenantId],
        );
        return { result: r.rows[0] ?? {} };
      }

      case 'get_forecast_report': {
        const table = process.env.REPORTING_TABLE;
        if (!table) {
          return { result: { available: false, reason: 'REPORTING_TABLE is not configured' } };
        }
        const item = await metering.send(new GetCommand({
          TableName: table,
          Key: { pk: `${tenantId}#report#pipeline_forecast`, sk: 'latest' },
        }));
        if (!item.Item) {
          return { result: { available: false, reason: 'No pipeline_forecast with sk=latest. The forecasting agent writes this on its daily schedule.' } };
        }
        return { result: { available: true, report: item.Item } };
      }

      case 'get_personal_queue': {
        const actorId = String(payload._actorId ?? payload.actorId ?? '');
        const pending = await db.query(
          `SELECT COUNT(*)::int AS n FROM activity
           WHERE tenant_id = $1 AND COALESCE(metadata->>'status','') = 'awaiting_approval'`,
          [tenantId],
        );
        const mine = actorId
          ? await db.query(
              `SELECT COUNT(*)::int AS n FROM activity
               WHERE tenant_id = $1 AND actor_id = $2 AND occurred_at >= NOW() - INTERVAL '30 days'`,
              [tenantId, actorId],
            )
          : { rows: [{ n: 0 }] };
        const running = await db.query(
          `SELECT COUNT(*)::int AS n FROM agent_run WHERE tenant_id = $1 AND status IN ('running','paused','pending')`,
          [tenantId],
        );
        return {
          result: {
            awaitingApproval: pending.rows[0]?.n ?? 0,
            myActivities30d: mine.rows[0]?.n ?? 0,
            runningAgents: running.rows[0]?.n ?? 0,
          },
        };
      }

      case 'list_invitations': {
        // Team management is an administrative view. token_hash is never
        // selected — nothing in the product ever needs to read it back.
        if (!('requestContext' in event) || !isManagerOrAdmin(event as APIGatewayProxyEvent)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Only admins and managers can view invitations' }) };
        }
        const rows = await db.query(
          `SELECT id, email, role, status, invited_by, expires_at, accepted_at, created_at,
                  (status = 'pending' AND expires_at <= NOW()) AS expired
             FROM invitation
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT 200`,
          [tenantId],
        );
        return { result: rows.rows };
      }

      case 'find_invitation': {
        // Looked up by token hash during sign-up, before any session exists, so
        // it is reachable only by direct invocation from the services that need
        // it (invitation-service resolve, tenant-provisioner PreSignUp).
        if ('requestContext' in event) {
          return { statusCode: 403, body: JSON.stringify({ error: 'not available over the API' }) };
        }
        const tokenHash = String(payload.tokenHash ?? '');
        if (tokenHash.length !== 64) return { result: null };
        const rows = await db.query(
          `SELECT i.id, i.tenant_id, i.email, i.role, i.status, i.expires_at,
                  (i.status = 'pending' AND i.expires_at > NOW()) AS usable,
                  t.name AS workspace_name
             FROM invitation i
             JOIN tenant t ON t.id = i.tenant_id
            WHERE i.token_hash = $1`,
          [tokenHash],
        );
        return { result: rows.rows[0] ?? null };
      }

      case 'list_threads': {
        // Owner-scoped, not tenant-scoped: a Home thread is one person's
        // scratchpad. Scoping this by tenant alone would put every colleague's
        // half-finished questions in everybody's sidebar.
        if (!('requestContext' in event)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'threads require a signed-in user' }) };
        }
        const sub = subOf(event as APIGatewayProxyEvent);
        if (!sub) return { result: [] };
        const limit = Math.min(100, Math.max(1, Number(payload.limit ?? 40)));
        const rows = await db.query(
          `SELECT t.id, t.title, t.goal, t.starter, t.status, t.created_at, t.updated_at,
                  (SELECT COUNT(*)::int FROM assistant_turn tr WHERE tr.thread_id = t.id) AS turn_count
             FROM assistant_thread t
            WHERE t.tenant_id = $1 AND t.user_sub = $2 AND t.status = 'active'
            ORDER BY t.updated_at DESC
            LIMIT $3`,
          [tenantId, sub, limit],
        );
        return { result: rows.rows };
      }

      case 'get_thread': {
        if (!('requestContext' in event)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'threads require a signed-in user' }) };
        }
        const sub = subOf(event as APIGatewayProxyEvent);
        const id = String(payload.id ?? '');
        if (!sub || !id) return { result: null };
        // The owner check is in the thread query, and the turn query is keyed on
        // a thread id that has already passed it — so an id belonging to someone
        // else returns null rather than their transcript.
        const head = await db.query(
          `SELECT id, title, goal, starter, status, created_at, updated_at
             FROM assistant_thread
            WHERE id = $1 AND tenant_id = $2 AND user_sub = $3`,
          [id, tenantId, sub],
        );
        if (!head.rows[0]) return { result: null };
        const turns = await db.query(
          `SELECT seq, role, kind, body, data, created_at
             FROM assistant_turn
            WHERE thread_id = $1 AND tenant_id = $2
            ORDER BY seq`,
          [id, tenantId],
        );
        return { result: { ...head.rows[0], turns: turns.rows } };
      }

      case 'export_dsar': {
        if (!('requestContext' in event) || !isManagerOrAdmin(event as APIGatewayProxyEvent)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Only admins and managers can export a data subject' }) };
        }
        const contactId = String(payload.contactId ?? '');
        if (!contactId) return { statusCode: 400, body: JSON.stringify({ error: 'contactId is required' }) };
        const contact = await db.query(
          `SELECT * FROM contact WHERE tenant_id = $1 AND id = $2`,
          [tenantId, contactId],
        );
        if (!contact.rows[0]) return { result: null };
        const [consent, activities, runs, calls, enrichment] = await Promise.all([
          db.query(`SELECT * FROM consent_record WHERE tenant_id = $1 AND contact_id = $2`, [tenantId, contactId]),
          db.query(`SELECT * FROM activity WHERE tenant_id = $1 AND contact_id = $2 ORDER BY occurred_at DESC LIMIT 500`, [tenantId, contactId]),
          db.query(`SELECT * FROM agent_run WHERE tenant_id = $1 AND contact_id = $2 ORDER BY started_at DESC LIMIT 200`, [tenantId, contactId]),
          db.query(
            `SELECT id, agent_run_id, contact_id, call_id, outcome, duration_seconds,
                    transcript_s3_key, summary_json, schema_valid, occurred_at,
                    ai_disclosure_delivered_at, ai_disclosure_text,
                    calling_window_allowed, calling_window_reason, dnc_result
             FROM call_result WHERE tenant_id = $1 AND contact_id = $2
             ORDER BY occurred_at DESC LIMIT 200`,
            [tenantId, contactId],
          ),
          db.query(`SELECT * FROM enrichment_record WHERE tenant_id = $1 AND contact_id = $2 ORDER BY fetched_at DESC LIMIT 200`, [tenantId, contactId]),
        ]);
        const eventsTable = process.env.DYNAMODB_TABLE;
        let auditEvents: unknown[] = [];
        if (eventsTable) {
          const byPk = await metering.send(new QueryCommand({
            TableName: eventsTable,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': `${tenantId}#contact#${contactId}` },
            Limit: 200,
          }));
          const byGsi = await metering.send(new QueryCommand({
            TableName: eventsTable,
            IndexName: 'gsi-contact',
            KeyConditionExpression: 'contact_id = :c',
            ExpressionAttributeValues: { ':c': contactId },
            Limit: 500,
          }));
          const seen = new Set<string>();
          auditEvents = [...(byPk.Items ?? []), ...(byGsi.Items ?? [])].filter((item) => {
            if (item.tenantId && item.tenantId !== tenantId) return false;
            const key = `${item.pk}#${item.sk}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        return {
          result: {
            exportedAt: new Date().toISOString(),
            tenantId,
            contact: contact.rows[0],
            consentRecords: consent.rows,
            activities: activities.rows,
            agentRuns: runs.rows,
            callResults: calls.rows,
            enrichmentRecords: enrichment.rows,
            auditEvents,
          },
        };
      }

      case 'export_audit': {
        if (!('requestContext' in event) || !isManagerOrAdmin(event as APIGatewayProxyEvent)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Only admins and managers can export the audit log' }) };
        }
        const eventsTable = process.env.DYNAMODB_TABLE;
        if (!eventsTable) {
          return { result: { incomplete: true, reason: 'DYNAMODB_TABLE is not configured', items: [] } };
        }
        const contactId = typeof payload.contactId === 'string' ? payload.contactId : '';
        const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : '';
        const agentRunId = typeof payload.agentRunId === 'string' ? payload.agentRunId : '';
        if (!contactId && !campaignId && !agentRunId) {
          return {
            result: {
              incomplete: true,
              reason: 'The events table has no tenant-wide GSI. Export by contactId, campaignId, or agentRunId.',
              items: [],
            },
          };
        }
        const indexName = contactId ? 'gsi-contact' : campaignId ? 'gsi-campaign' : 'gsi-agent-run';
        const keyName = contactId ? 'contact_id' : campaignId ? 'campaign_id' : 'agent_run_id';
        const keyVal = contactId || campaignId || agentRunId;
        const ev = await metering.send(new QueryCommand({
          TableName: eventsTable,
          IndexName: indexName,
          KeyConditionExpression: `${keyName} = :k`,
          ExpressionAttributeValues: { ':k': keyVal },
          Limit: 500,
        }));
        return {
          result: {
            incomplete: false,
            items: (ev.Items ?? []).filter((item) => item.tenantId === tenantId),
          },
        };
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
