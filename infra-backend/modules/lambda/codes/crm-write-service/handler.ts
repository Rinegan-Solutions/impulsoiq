/**
 * CRM Write Service — the ONLY Lambda allowed to write to Aurora DSQL.
 *
 * Every specialist agent calls this via AgentCore Gateway (tool: write_record).
 * Direct DSQL writes from any other Lambda or agent are prohibited by policy.
 *
 * Tenant isolation: every query includes a tenant_id parameter.
 * OCC retries: DSQL can surface OCC errors; callers should retry with backoff.
 */
import type { APIGatewayProxyEvent, Handler } from 'aws-lambda';
import { getDb, closeDb } from './db';
import { publishEvent, recordFirstActivation } from './events';

type Operation =
  | 'upsert_tenant'         // restricted: only tenant-provisioner may call this
  | 'upsert_contact'
  | 'upsert_account'
  | 'upsert_deal'
  | 'upsert_activity'
  | 'upsert_agent_run'
  | 'upsert_campaign'
  | 'upsert_workspace_template'
  | 'upsert_call_result'
  | 'upsert_consent_record'
  | 'check_consent'
  | 'patch_activity'
  | 'merge_contacts'
  | 'insert_enrichment_records'
  | 'upsert_sequence'
  | 'patch_tenant_config'
  | 'set_tenant_billing'    // restricted: billing-service only
  | 'create_invitation'     // restricted: invitation-service only
  | 'revoke_invitation'     // restricted: invitation-service only
  | 'consume_invitation'    // restricted: tenant-provisioner only
  | 'save_thread'           // Home assistant transcript; owner-scoped, API only
  | 'archive_thread'        // Home assistant transcript; owner-scoped, API only
  | 'save_sso_intent'
  | 'patch_expansion_config'
  | 'erase_dsar'
  // Phase 7: support entities
  | 'upsert_conversation'
  | 'upsert_message'
  | 'upsert_ticket'
  | 'upsert_rep_status'
  | 'upsert_macro'
  | 'upsert_knowledge_article'
  | 'resolve_conversation'
  // Phase 8: resolution + CSAT
  | 'update_csat_score';

interface WriteRequest {
  operation: Operation;
  payload:   Record<string, unknown>;
  actorType?: 'human' | 'agent';
  actorId?:   string;
}

interface WriteResponse {
  ok:     boolean;
  id?:    string;
  result?: Record<string, unknown>;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// COGNITO_USER_POOLS authorizer -> verified ID-token claims as a flat string
// map at requestContext.authorizer.claims. NOT authorizer.tenantId (that is the
// custom-authorizer shape) and NOT authorizer.jwt.claims (HTTP API v2).
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

function iso(d?: unknown): string {
  return d ? new Date(d as string).toISOString() : new Date().toISOString();
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

async function upsertContact(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const res = await db.query(
    `INSERT INTO contact (id, tenant_id, account_id, first_name, last_name, email,
       phone, title, linkedin_url, stage, score, enrichment_json, custom_fields)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9,
             COALESCE($10,'Prospecting'), COALESCE($11,0), COALESCE($12,'{}')::jsonb,
             COALESCE($13,'{}')::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       account_id      = EXCLUDED.account_id,
       first_name      = EXCLUDED.first_name,
       last_name       = EXCLUDED.last_name,
       email           = EXCLUDED.email,
       phone           = EXCLUDED.phone,
       title           = EXCLUDED.title,
       linkedin_url    = EXCLUDED.linkedin_url,
       stage           = EXCLUDED.stage,
       score           = EXCLUDED.score,
       enrichment_json = EXCLUDED.enrichment_json,
       custom_fields   = EXCLUDED.custom_fields,
       updated_at      = NOW()
     RETURNING id`,
    [p.id ?? null, tenantId, p.accountId ?? null, p.firstName, p.lastName, p.email ?? null,
     p.phone ?? null, p.title ?? null, p.linkedinUrl ?? null,
     p.stage ?? null, p.score ?? null,
     p.enrichmentJson ? JSON.stringify(p.enrichmentJson) : null,
     p.customFields  ? JSON.stringify(p.customFields)   : null],
  );
  return res.rows[0].id as string;
}

async function upsertAccount(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const res = await db.query(
    `INSERT INTO account (id, tenant_id, name, domain, industry, website,
       employee_count, annual_revenue, enrichment_json, custom_fields)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8,
             COALESCE($9,'{}')::jsonb, COALESCE($10,'{}')::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name            = EXCLUDED.name,
       domain          = EXCLUDED.domain,
       industry        = EXCLUDED.industry,
       website         = EXCLUDED.website,
       employee_count  = EXCLUDED.employee_count,
       annual_revenue  = EXCLUDED.annual_revenue,
       enrichment_json = EXCLUDED.enrichment_json,
       custom_fields   = EXCLUDED.custom_fields,
       updated_at      = NOW()
     RETURNING id`,
    [p.id ?? null, tenantId, p.name, p.domain ?? null, p.industry ?? null,
     p.website ?? null, p.employeeCount ?? null, p.annualRevenue ?? null,
     p.enrichmentJson ? JSON.stringify(p.enrichmentJson) : null,
     p.customFields   ? JSON.stringify(p.customFields)   : null],
  );
  return res.rows[0].id as string;
}

async function upsertDeal(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const res = await db.query(
    `INSERT INTO deal (id, tenant_id, account_id, contact_id, name, amount, stage,
       probability, close_date, custom_fields)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, COALESCE($6,0),
             COALESCE($7,'Prospecting'), COALESCE($8,0), $9,
             COALESCE($10,'{}')::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       account_id    = EXCLUDED.account_id,
       contact_id    = EXCLUDED.contact_id,
       name          = EXCLUDED.name,
       amount        = EXCLUDED.amount,
       stage         = EXCLUDED.stage,
       probability   = EXCLUDED.probability,
       close_date    = EXCLUDED.close_date,
       custom_fields = EXCLUDED.custom_fields,
       updated_at    = NOW()
     RETURNING id`,
    [p.id ?? null, tenantId, p.accountId, p.contactId ?? null, p.name,
     p.amount ?? null, p.stage ?? null, p.probability ?? null,
     p.closeDate ?? null,
     p.customFields ? JSON.stringify(p.customFields) : null],
  );
  return res.rows[0].id as string;
}

async function upsertActivity(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const res = await db.query(
    `INSERT INTO activity (id, tenant_id, contact_id, account_id, deal_id,
       agent_run_id, type, actor_type, actor_id, subject, body, metadata, occurred_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11, COALESCE($12,'{}')::jsonb, COALESCE($13, NOW()))
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [p.id ?? null, tenantId, p.contactId ?? null, p.accountId ?? null,
     p.dealId ?? null, p.agentRunId ?? null, p.type, p.actorType, p.actorId,
     p.subject ?? null, p.body ?? null,
     p.metadata ? JSON.stringify(p.metadata) : null,
     p.occurredAt ?? null],
  );
  return (res.rows[0]?.id ?? p.id) as string;
}

async function patchActivity(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const meta = p.metadata && typeof p.metadata === 'object' ? JSON.stringify(p.metadata) : '{}';
  const res = await db.query(
    `UPDATE activity
     SET subject  = COALESCE($3, subject),
         body     = COALESCE($4, body),
         metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
     WHERE id = $1 AND tenant_id = $2
     RETURNING id`,
    [p.id, tenantId, p.subject ?? null, p.body ?? null, meta],
  );
  if (!res.rows[0]) throw new Error('activity not found');
  return res.rows[0].id as string;
}

async function mergeContacts(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const survivorId = String(p.survivorId ?? '');
  const duplicateId = String(p.duplicateId ?? '');
  if (!survivorId || !duplicateId || survivorId === duplicateId) {
    throw new Error('survivorId and duplicateId must be distinct');
  }
  const pair = await db.query(
    `SELECT id, first_name, last_name, email, phone, title, account_id, linkedin_url, custom_fields
     FROM contact WHERE tenant_id = $1 AND id IN ($2, $3)`,
    [tenantId, survivorId, duplicateId],
  );
  if (pair.rowCount !== 2) throw new Error('Both contacts must exist in this workspace');
  const duplicate = pair.rows.find((r) => r.id === duplicateId)!;
  await db.query(
    `UPDATE contact SET
       email        = COALESCE(NULLIF(contact.email, ''), $3),
       phone        = COALESCE(NULLIF(contact.phone, ''), $4),
       title        = COALESCE(NULLIF(contact.title, ''), $5),
       account_id   = COALESCE(contact.account_id, $6),
       linkedin_url = COALESCE(NULLIF(contact.linkedin_url, ''), $7),
       updated_at   = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [survivorId, tenantId, duplicate.email, duplicate.phone, duplicate.title,
     duplicate.account_id, duplicate.linkedin_url],
  );
  await db.query(
    `UPDATE deal SET contact_id = $1, updated_at = NOW()
     WHERE tenant_id = $2 AND contact_id = $3`,
    [survivorId, tenantId, duplicateId],
  );
  await db.query(
    `UPDATE activity SET contact_id = $1
     WHERE tenant_id = $2 AND contact_id = $3`,
    [survivorId, tenantId, duplicateId],
  );
  const merged = {
    ...(duplicate.custom_fields && typeof duplicate.custom_fields === 'object' ? duplicate.custom_fields as object : {}),
    mergedInto: survivorId,
    mergedAt: new Date().toISOString(),
    mergedFromName: `${duplicate.first_name} ${duplicate.last_name}`,
  };
  await db.query(
    `UPDATE contact SET custom_fields = $3::jsonb, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [duplicateId, tenantId, JSON.stringify(merged)],
  );
  return survivorId;
}

const AGENT_TYPES = new Set([
  'coordinator', 'clarification', 'research_enrichment', 'outreach', 'voice',
  'nurture', 'forecasting_insight', 'data_hygiene', 'ambient_interface',
  'deep_research', 'signal_listening', 'triage_escalation', 'resolution',
  'support_insight',
]);

async function upsertAgentRun(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const agentType = String(p.agentType ?? '');
  if (!AGENT_TYPES.has(agentType)) {
    throw new Error(`upsert_agent_run: agentType '${agentType}' is not in the roster allowlist`);
  }
  const res = await db.query(
    `INSERT INTO agent_run (id, tenant_id, campaign_id, contact_id, agent_type,
       status, step_functions_execution_arn, input, cost_json, started_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5,
             COALESCE($6,'pending'), $7, COALESCE($8,'{}')::jsonb,
             COALESCE($12,'{}')::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       status                       = EXCLUDED.status,
       step_functions_execution_arn = COALESCE(EXCLUDED.step_functions_execution_arn, agent_run.step_functions_execution_arn),
       input    = COALESCE($8::jsonb, agent_run.input),
       output   = CASE WHEN $9::jsonb IS NOT NULL THEN $9::jsonb ELSE agent_run.output END,
       error    = CASE WHEN $11::boolean THEN $10 ELSE agent_run.error END,
       cost_json = CASE WHEN $12::jsonb IS NOT NULL THEN $12::jsonb ELSE agent_run.cost_json END,
       ended_at = CASE
                    WHEN $6 IN ('completed','failed') THEN NOW()
                    WHEN $6 IN ('running','paused','pending') THEN NULL
                    ELSE agent_run.ended_at
                  END
     RETURNING id`,
    [p.id ?? null, tenantId, p.campaignId ?? null, p.contactId ?? null, agentType,
     p.status ?? null, p.stepFunctionsExecutionArn ?? null,
     p.input ? JSON.stringify(p.input) : null,
     p.output ? JSON.stringify(p.output) : null,
     p.error === undefined ? null : p.error,
     p.error !== undefined,
     p.costJson ? JSON.stringify(p.costJson) : null],
  );
  return res.rows[0].id as string;
}

async function upsertCampaign(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const res = await db.query(
    `INSERT INTO campaign (id, tenant_id, name, type, status, config, goal_template)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, COALESCE($4,'sdr_qualification'),
             COALESCE($5,'draft'), COALESCE($6,'{}')::jsonb, $7)
     ON CONFLICT (id) DO UPDATE SET
       name          = EXCLUDED.name,
       status        = EXCLUDED.status,
       config        = EXCLUDED.config,
       goal_template = EXCLUDED.goal_template,
       updated_at    = NOW()
     RETURNING id`,
    [p.id ?? null, tenantId, p.name, p.type ?? null, p.status ?? null,
     p.config ? JSON.stringify(p.config) : null, p.goalTemplate ?? null],
  );
  return res.rows[0].id as string;
}

async function upsertWorkspaceTemplate(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  // Conflict target is (tenant_id, template_key) -- the natural key -- so the
  // caller can activate a template it has never activated before without
  // knowing a row id.
  //
  // Every updatable column is COALESCE(EXCLUDED.x, workspace_template.x) so a
  // partial payload such as {templateKey, status} preserves the name, config
  // and legal-review fields instead of blanking them. That matters most for
  // legal_reviewed_by/at: template-launcher REFUSES to launch
  // accounts_receivable without them, so silently clearing them here would
  // disable the campaign with no visible cause.
  const res = await db.query(
    `INSERT INTO workspace_template
       (id, tenant_id, template_key, name, status, config,
        legal_reviewed_by, legal_reviewed_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, COALESCE($4, $3),
             COALESCE($5,'inactive'), COALESCE($6,'{}')::jsonb, $7, $8)
     ON CONFLICT (tenant_id, template_key) DO UPDATE SET
       name              = COALESCE(EXCLUDED.name,              workspace_template.name),
       status            = COALESCE(EXCLUDED.status,            workspace_template.status),
       config            = COALESCE(EXCLUDED.config,            workspace_template.config),
       legal_reviewed_by = COALESCE(EXCLUDED.legal_reviewed_by, workspace_template.legal_reviewed_by),
       legal_reviewed_at = COALESCE(EXCLUDED.legal_reviewed_at, workspace_template.legal_reviewed_at),
       updated_at        = NOW()
     RETURNING id`,
    [p.id ?? null, tenantId, p.templateKey, p.name ?? null, p.status ?? null,
     p.config ? JSON.stringify(p.config) : null,
     p.legalReviewedBy ?? null, p.legalReviewedAt ?? null],
  );
  return res.rows[0].id as string;
}

const CALL_OUTCOMES = new Set(['answered', 'voicemail', 'no_answer', 'busy', 'failed']);

function callResultSchemaValid(p: Record<string, unknown>): boolean {
  const outcome = String(p.outcome ?? '');
  if (!CALL_OUTCOMES.has(outcome)) return false;
  if (p.schemaValid === false) return false;
  if (outcome !== 'answered') return true;
  const summary = p.summaryJson;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
  const s = summary as Record<string, unknown>;
  return 'interest_level' in s || 'interestLevel' in s || 'meeting_booked' in s || 'meetingBooked' in s;
}

async function insertEnrichmentRecords(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const rows = Array.isArray(p.records) ? p.records as Record<string, unknown>[] : [];
  if (rows.length === 0) throw new Error('insert_enrichment_records: records array is required');
  let lastId = '';
  for (const rec of rows.slice(0, 40)) {
    const conf = Math.min(1, Math.max(0, Number(rec.confidence ?? 0)));
    const res = await db.query(
      `INSERT INTO enrichment_record
         (id, tenant_id, contact_id, account_id, source, field, value, confidence, fetched_at, decay_policy, metadata)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()), COALESCE($10,'90d'), COALESCE($11,'{}')::jsonb)
       RETURNING id`,
      [
        rec.id ?? null, tenantId, rec.contactId ?? p.contactId ?? null, rec.accountId ?? p.accountId ?? null,
        rec.source, rec.field, rec.value == null ? null : String(rec.value), conf,
        rec.fetchedAt ?? null, rec.decayPolicy ?? '90d',
        rec.metadata ? JSON.stringify(rec.metadata) : '{}',
      ],
    );
    lastId = res.rows[0].id as string;
  }
  return lastId;
}

async function upsertSequence(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const allowed = new Set(['email', 'sms', 'wait', 'call', 'task']);
  const rawSteps = Array.isArray(p.steps) ? p.steps as Record<string, unknown>[] : [];
  const steps = rawSteps.map((step, i) => {
    const type = String(step.type ?? '');
    if (!allowed.has(type)) throw new Error(`sequence step ${i}: type must be email, sms, wait, call, or task`);
    const waitSeconds = type === 'wait' ? Math.max(0, Math.min(86400 * 30, Number(step.waitSeconds ?? 0))) : undefined;
    return {
      id: typeof step.id === 'string' && step.id ? step.id : `step-${i + 1}`,
      type,
      ...(waitSeconds !== undefined ? { waitSeconds } : {}),
      ...(typeof step.subject === 'string' ? { subject: step.subject } : {}),
      ...(typeof step.body === 'string' ? { body: step.body } : {}),
      ...(typeof step.title === 'string' ? { title: step.title } : {}),
    };
  });
  const res = await db.query(
    `INSERT INTO sequence (id, tenant_id, name, status, steps)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, COALESCE($4,'active'), $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name       = EXCLUDED.name,
       status     = COALESCE(EXCLUDED.status, sequence.status),
       steps      = EXCLUDED.steps,
       updated_at = NOW()
     RETURNING id`,
    [p.id ?? null, tenantId, p.name, p.status ?? null, JSON.stringify(steps)],
  );
  return res.rows[0].id as string;
}

const INVITE_ROLES = new Set(['admin', 'manager', 'member']);

/**
 * Create (or replace) the single live invitation for an email in a workspace.
 *
 * The caller supplies only a SHA-256 hash of the token — the raw value lives in
 * the emailed link and nowhere else, so a database copy yields no usable invite.
 * Re-inviting revokes the previous pending row first, which keeps "one live
 * invitation per person" true and makes resend a normal create.
 */
async function createInvitation(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const email = String(p.email ?? '').trim().toLowerCase();
  const role = String(p.role ?? '');
  const tokenHash = String(p.tokenHash ?? '');
  const invitedBy = String(p.invitedBy ?? '');
  const expiresAt = String(p.expiresAt ?? '');
  if (!email.includes('@')) throw new Error('create_invitation: a valid email is required');
  if (!INVITE_ROLES.has(role)) throw new Error(`create_invitation: invalid role ${role}`);
  if (tokenHash.length !== 64) throw new Error('create_invitation: tokenHash must be a sha256 hex digest');
  if (!expiresAt) throw new Error('create_invitation: expiresAt is required');

  await db.query(
    `UPDATE invitation SET status = 'revoked', updated_at = NOW()
      WHERE tenant_id = $1 AND email = $2 AND status = 'pending'`,
    [tenantId, email],
  );
  const res = await db.query(
    `INSERT INTO invitation (tenant_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     RETURNING id`,
    [tenantId, email, role, tokenHash, invitedBy, expiresAt],
  );
  return res.rows[0].id as string;
}

async function revokeInvitation(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const id = String(p.id ?? '');
  if (!id) throw new Error('revoke_invitation: id is required');
  const res = await db.query(
    `UPDATE invitation SET status = 'revoked', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
      RETURNING id`,
    [id, tenantId],
  );
  if (res.rowCount === 0) throw new Error('revoke_invitation: no pending invitation with that id');
  return id;
}

/**
 * Claim an invitation, atomically.
 *
 * The WHERE clause is the guard: only a pending, unexpired invitation for this
 * exact email can move to accepted, and it can only do so once. Two concurrent
 * confirmations cannot both succeed, so a duplicate request cannot produce two
 * memberships. Returns the granted role, or null when there was nothing to claim.
 */
async function consumeInvitation(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const email = String(p.email ?? '').trim().toLowerCase();
  const sub = String(p.sub ?? '');
  if (!email) return { id: null as string | null, role: null as string | null };
  const res = await db.query(
    `UPDATE invitation
        SET status = 'accepted', accepted_at = NOW(), accepted_sub = $3, updated_at = NOW()
      WHERE tenant_id = $1 AND email = $2 AND status = 'pending' AND expires_at > NOW()
      RETURNING id, role`,
    [tenantId, email, sub],
  );
  const row = res.rows[0];
  return { id: (row?.id as string) ?? null, role: (row?.role as string) ?? null };
}

const TURN_KINDS = new Set(['text', 'error', 'questions', 'plan']);
/** A thread is a scratchpad, not an archive. Far past what anyone scrolls back through. */
const MAX_TURNS_PER_THREAD = 400;

/**
 * Create or update one Home thread and APPEND any turns it does not yet have.
 *
 * Append-only by sequence number, deliberately. The browser re-sends the whole
 * transcript on every save, so a retry, a double-click or two tabs on the same
 * thread must not duplicate turns — only rows with seq beyond what is already
 * stored are inserted. That also means a save cannot rewrite history: an earlier
 * turn is never updated or deleted by this path.
 *
 * ownerSub scopes everything. An UPDATE that does not match the owner touches no
 * rows, so passing someone else's thread id changes nothing rather than
 * succeeding quietly on their data.
 */
async function saveThread(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  tenantId: string,
  ownerSub: string,
  p: Record<string, unknown>,
) {
  if (!ownerSub) throw new Error('save_thread: no authenticated user');

  const rawTurns = Array.isArray(p.turns) ? (p.turns as Record<string, unknown>[]) : [];
  if (rawTurns.length > MAX_TURNS_PER_THREAD) {
    throw new Error(`save_thread: a thread cannot exceed ${MAX_TURNS_PER_THREAD} turns`);
  }

  const goal = String(p.goal ?? '').slice(0, 4000);
  // The list needs something readable; the first goal is the honest label.
  const title = (String(p.title ?? '').trim() || goal).slice(0, 200);
  const starter = p.starter == null ? null : String(p.starter).slice(0, 80);

  let threadId = String(p.id ?? '');

  if (threadId) {
    const updated = await db.query(
      `UPDATE assistant_thread
          SET title = $3, goal = $4, starter = $5, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND user_sub = $6
        RETURNING id`,
      [threadId, tenantId, title, goal, starter, ownerSub],
    );
    // Not theirs, or gone. Never fall through to creating a new one under this
    // id — that would let a guessed id decide a row's primary key.
    if (updated.rowCount === 0) throw new Error('save_thread: no such thread');
  } else {
    const created = await db.query(
      `INSERT INTO assistant_thread (tenant_id, user_sub, title, goal, starter)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tenantId, ownerSub, title, goal, starter],
    );
    threadId = created.rows[0].id as string;
  }

  const existing = await db.query(
    `SELECT COALESCE(MAX(seq), -1)::int AS max_seq FROM assistant_turn WHERE thread_id = $1`,
    [threadId],
  );
  const from = Number(existing.rows[0]?.max_seq ?? -1) + 1;

  for (let seq = from; seq < rawTurns.length; seq += 1) {
    const turn = rawTurns[seq] ?? {};
    const role = turn.role === 'user' ? 'user' : 'assistant';
    const kind = TURN_KINDS.has(String(turn.kind)) ? String(turn.kind) : 'text';
    const body = String(turn.body ?? turn.text ?? '').slice(0, 20000);
    const data = turn.data && typeof turn.data === 'object' ? turn.data : {};
    await db.query(
      `INSERT INTO assistant_turn (tenant_id, thread_id, seq, role, kind, body, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [tenantId, threadId, seq, role, kind, body, JSON.stringify(data)],
    );
  }

  return { id: threadId, appended: Math.max(0, rawTurns.length - from) };
}

async function archiveThread(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  tenantId: string,
  ownerSub: string,
  p: Record<string, unknown>,
) {
  const id = String(p.id ?? '');
  if (!id) throw new Error('archive_thread: id is required');
  if (!ownerSub) throw new Error('archive_thread: no authenticated user');
  const res = await db.query(
    `UPDATE assistant_thread SET status = 'archived', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND user_sub = $3
      RETURNING id`,
    [id, tenantId, ownerSub],
  );
  if (res.rowCount === 0) throw new Error('archive_thread: no such thread');
  return id;
}

/** The Cognito sub of the signed-in caller. Threads are scoped to it. */
function subOf(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  return String(claims?.sub ?? '');
}

function isManagerOrAdmin(event: APIGatewayProxyEvent): boolean {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  const raw = claims?.['cognito:groups'];
  const values = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[\s,[\]"]+/);
  return values.some((g) => g === 'admin' || g === 'manager');
}

async function patchTenantConfig(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const profile = p.brandVoiceProfile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('brandVoiceProfile object is required');
  }
  const src = profile as Record<string, unknown>;
  const allowed: Record<string, unknown> = {};
  for (const key of ['tone', 'persona', 'pillars', 'forbiddenPhrases', 'mailingAddress', 'senderName']) {
    if (src[key] !== undefined) allowed[key] = src[key];
  }
  const current = await db.query(`SELECT COALESCE(config, '{}'::jsonb) AS config FROM tenant WHERE id = $1`, [tenantId]);
  if (!current.rows[0]) throw new Error('tenant not found');
  const config = {
    ...(current.rows[0].config as Record<string, unknown>),
    brand_voice_profile: allowed,
  };
  await db.query(`UPDATE tenant SET config = $2::jsonb, updated_at = NOW() WHERE id = $1`, [tenantId, JSON.stringify(config)]);
  return tenantId;
}

const BILLING_TIERS = new Set(['free', 'starter', 'growth', 'enterprise']);

async function setTenantBilling(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const current = await db.query(`SELECT tier, COALESCE(config, '{}'::jsonb) AS config FROM tenant WHERE id = $1`, [tenantId]);
  if (!current.rows[0]) throw new Error('tenant not found');
  const config = { ...(current.rows[0].config as Record<string, unknown>) };
  if (typeof p.stripeCustomerId === 'string' && p.stripeCustomerId) {
    config.stripeCustomerId = p.stripeCustomerId;
  }
  if (typeof p.stripeSubscriptionId === 'string') {
    config.stripeSubscriptionId = p.stripeSubscriptionId;
  }
  const nextTier = typeof p.tier === 'string' ? p.tier : String(current.rows[0].tier);
  if (!BILLING_TIERS.has(nextTier)) throw new Error(`invalid tier: ${nextTier}`);
  await db.query(
    `UPDATE tenant SET tier = $2, config = $3::jsonb, updated_at = NOW() WHERE id = $1`,
    [tenantId, nextTier, JSON.stringify(config)],
  );
  return tenantId;
}

async function saveSsoIntent(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const url = String(p.metadataUrl ?? '').trim();
  if (!/^https:\/\//i.test(url)) throw new Error('metadataUrl must be an https URL');
  const provider = String(p.provider ?? 'generic').slice(0, 64);
  const current = await db.query(`SELECT COALESCE(config, '{}'::jsonb) AS config FROM tenant WHERE id = $1`, [tenantId]);
  if (!current.rows[0]) throw new Error('tenant not found');
  const config = {
    ...(current.rows[0].config as Record<string, unknown>),
    ssoMetadataUrl: url,
    ssoProvider: provider,
    ssoSubmittedAt: new Date().toISOString(),
  };
  // sso_configured stays false until an operator attaches the IdP at the pool (sso.tf).
  await db.query(
    `UPDATE tenant SET config = $2::jsonb, sso_provider_id = $3, sso_configured = FALSE, updated_at = NOW() WHERE id = $1`,
    [tenantId, JSON.stringify(config), provider],
  );
  return tenantId;
}

async function patchExpansionConfig(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const current = await db.query(`SELECT COALESCE(config, '{}'::jsonb) AS config FROM tenant WHERE id = $1`, [tenantId]);
  if (!current.rows[0]) throw new Error('tenant not found');
  const config = { ...(current.rows[0].config as Record<string, unknown>) };
  const prev = (config.expansion && typeof config.expansion === 'object' && !Array.isArray(config.expansion))
    ? config.expansion as Record<string, unknown>
    : {};
  const expansion = { ...prev };
  if (typeof p.csDesignPartner === 'boolean') expansion.csDesignPartner = p.csDesignPartner;
  config.expansion = expansion;
  await db.query(`UPDATE tenant SET config = $2::jsonb, updated_at = NOW() WHERE id = $1`, [tenantId, JSON.stringify(config)]);
  return tenantId;
}

async function eraseDsar(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const contactId = String(p.contactId ?? '');
  if (!contactId) throw new Error('contactId is required');
  await db.query(`DELETE FROM enrichment_record WHERE tenant_id = $1 AND contact_id = $2`, [tenantId, contactId]);
  await db.query(`DELETE FROM consent_record WHERE tenant_id = $1 AND contact_id = $2`, [tenantId, contactId]);
  await db.query(`DELETE FROM call_result WHERE tenant_id = $1 AND contact_id = $2`, [tenantId, contactId]);
  await db.query(`DELETE FROM activity WHERE tenant_id = $1 AND contact_id = $2`, [tenantId, contactId]);
  await db.query(`DELETE FROM agent_run WHERE tenant_id = $1 AND contact_id = $2`, [tenantId, contactId]);
  await db.query(`UPDATE deal SET contact_id = NULL, updated_at = NOW() WHERE tenant_id = $1 AND contact_id = $2`, [tenantId, contactId]);
  const del = await db.query(`DELETE FROM contact WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantId, contactId]);
  if ((del.rowCount ?? 0) === 0) throw new Error('contact not found');
  return contactId;
}

async function upsertCallResult(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  if (!CALL_OUTCOMES.has(String(p.outcome ?? ''))) {
    throw new Error('malformed_call_result_schema: outcome must be answered, voicemail, no_answer, busy, or failed');
  }
  const schemaValid = callResultSchemaValid(p);
  p.schemaValid = schemaValid;
  const res = await db.query(
    `INSERT INTO call_result (id, tenant_id, agent_run_id, contact_id, call_id,
       idempotency_key, outcome, duration_seconds, transcript_s3_key, summary_json,
       schema_valid, occurred_at,
       ai_disclosure_delivered_at, ai_disclosure_text,
       calling_window_allowed, calling_window_reason, dnc_result)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9,
             $10::jsonb, $11, COALESCE($12, NOW()),
             $13::timestamptz, $14, $15, $16, $17)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [p.id ?? null, tenantId, p.agentRunId ?? null, p.contactId, p.callId,
     p.idempotencyKey, p.outcome, p.durationSeconds ?? null,
     p.transcriptS3Key ?? null,
     p.summaryJson ? JSON.stringify(p.summaryJson) : null,
     p.schemaValid ?? null, p.occurredAt ?? null,
     p.aiDisclosureDeliveredAt ?? null, p.aiDisclosureText ?? null,
     p.callingWindowAllowed ?? null, p.callingWindowReason ?? null,
     p.dncResult == null ? null : (typeof p.dncResult === 'string' ? p.dncResult : JSON.stringify(p.dncResult))],
  );
  const id = (res.rows[0]?.id ?? p.id) as string;
  if (!schemaValid) {
    throw new Error('malformed_call_result_schema: answered calls require interest_level or meeting_booked in summaryJson');
  }
  return id;
}

async function upsertConsentRecord(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const res = await db.query(
    `INSERT INTO consent_record (id, tenant_id, contact_id, channel, granted,
       source, source_ref, recorded_at, expires_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
             COALESCE($8, NOW()), $9)
     ON CONFLICT (tenant_id, contact_id, channel) DO UPDATE SET
       granted     = EXCLUDED.granted,
       source      = EXCLUDED.source,
       source_ref  = EXCLUDED.source_ref,
       recorded_at = EXCLUDED.recorded_at,
       expires_at  = EXCLUDED.expires_at
     RETURNING id`,
    [p.id ?? null, tenantId, p.contactId, p.channel, p.granted,
     p.source, p.sourceRef ?? null, p.recordedAt ?? null, p.expiresAt ?? null],
  );
  return res.rows[0].id as string;
}

async function checkConsent(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>): Promise<WriteResponse> {
  const res = await db.query(
    `SELECT granted, expires_at FROM consent_record
     WHERE tenant_id = $1 AND contact_id = $2 AND channel = $3
     ORDER BY recorded_at DESC LIMIT 1`,
    [tenantId, p.contactId, p.channel],
  );
  if (res.rowCount === 0) return { ok: true, result: { hasConsent: false, reason: 'no_record' } };
  const row = res.rows[0];
  if (!row.granted)     return { ok: true, result: { hasConsent: false, reason: 'revoked' } };
  if (row.expires_at && new Date(row.expires_at) < new Date())
    return { ok: true, result: { hasConsent: false, reason: 'expired' } };
  return { ok: true, result: { hasConsent: true } };
}

async function upsertTenant(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  // CREATE IF ABSENT — never overwrite.
  //
  // This was ON CONFLICT DO UPDATE setting name, tier and config from the
  // payload. tenant-provisioner calls it for EVERY confirmed sign-up, including
  // people joining an existing workspace, so each join reset the workspace's
  // name to its slug, its tier to 'starter' and its config to {}. It also
  // detected a fresh insert with (xmax = 0), a PostgreSQL system column that
  // Aurora DSQL does not document. rowCount from DO NOTHING ... RETURNING, plus a
  // read when nothing was inserted, needs neither.
  const inserted = await db.query(
    `INSERT INTO tenant (id, name, subdomain, email_domain, tier, config)
     VALUES ($1, $2, $3, $4, COALESCE($5,'free'), COALESCE($6,'{}')::jsonb)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [tenantId, p.name ?? tenantId, p.subdomain ?? tenantId, p.emailDomain ?? null,
     p.tier ?? null, p.config ? JSON.stringify(p.config) : null],
  );
  if ((inserted.rowCount ?? 0) > 0) {
    return { id: tenantId, was_inserted: true, email_domain: (p.emailDomain as string | null | undefined) ?? null };
  }
  // The provisioner needs the EXISTING domain to decide whether this account may join.
  const existing = await db.query(`SELECT email_domain FROM tenant WHERE id = $1`, [tenantId]);
  const row = existing.rows[0] as { email_domain?: string | null } | undefined;
  return { id: tenantId, was_inserted: false, email_domain: row?.email_domain ?? null };
}

// ── Entry point (API Gateway + direct Lambda invocation from agents) ──────────

const dispatch: Handler<
  { operation: Operation; payload: Record<string, unknown>; tenantId?: string; actorType?: string; actorId?: string }
  | APIGatewayProxyEvent,
  unknown
> = async (event) => {
  // Support two invocation modes:
  // 1. Via API Gateway (human UI) — tenantId from JWT claims
  // 2. Direct Lambda invocation from agents — tenantId in event body
  let tenantId: string | null = null;
  let req: WriteRequest;

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
    req = JSON.parse(apigwEvent.body ?? '{}') as WriteRequest;
  } else {
    // Direct agent invocation path
    const directEvent = event as { operation: Operation; payload: Record<string, unknown>; tenantId: string; actorType?: string; actorId?: string };
    tenantId = directEvent.tenantId;
    req = { operation: directEvent.operation, payload: directEvent.payload,
            actorType: directEvent.actorType as 'human'|'agent', actorId: directEvent.actorId };
  }

  if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: 'tenantId is required' }) };

  const { operation, payload, actorType = 'agent', actorId = 'system' } = req;

  try {
    const db = await getDb();
    let entityId: string;
    let entityType: string;
    let extra: Record<string, unknown> = {};

    switch (operation) {
      case 'check_consent':
        return checkConsent(db, tenantId, payload);

      case 'upsert_tenant':
        // Hard restriction: only the tenant-provisioner trigger may create/update tenants.
        // Direct API Gateway callers are blocked; agent callers that spoof actorId are
        // blocked at the IAM policy level (only tenant-provisioner has lambda:InvokeFunction).
        if ('requestContext' in event) {
          return { statusCode: 403, body: JSON.stringify({ error: 'tenant operations require direct invocation' }) };
        }
        if (req.actorId !== 'tenant-provisioner') {
          return { ok: false, error: 'upsert_tenant: caller must identify as tenant-provisioner' };
        }
        const tenantResult = await upsertTenant(db, tenantId, payload);
        entityId   = tenantResult.id;
        entityType = 'tenant';
        // Surface wasInserted so the provisioner knows admin vs member assignment
        return { ok: true, id: entityId, wasInserted: tenantResult.was_inserted, emailDomain: tenantResult.email_domain };

      case 'upsert_contact':
        entityId   = await upsertContact(db, tenantId, payload);
        entityType = 'contact';
        break;

      case 'upsert_account':
        entityId   = await upsertAccount(db, tenantId, payload);
        entityType = 'account';
        break;

      case 'upsert_deal':
        entityId   = await upsertDeal(db, tenantId, payload);
        entityType = 'deal';
        break;

      case 'upsert_activity':
        entityId   = await upsertActivity(db, tenantId, payload);
        entityType = 'activity';
        break;

      case 'patch_activity':
        entityId   = await patchActivity(db, tenantId, payload);
        entityType = 'activity';
        break;

      case 'merge_contacts':
        if ('requestContext' in (event as object)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'merge_contacts requires the Approvals controller, not a direct CRM write' }) };
        }
        entityId   = await mergeContacts(db, tenantId, payload);
        entityType = 'contact';
        break;

      case 'upsert_agent_run':
        entityId   = await upsertAgentRun(db, tenantId, payload);
        entityType = 'agent_run';
        break;

      case 'upsert_campaign':
        entityId   = await upsertCampaign(db, tenantId, payload);
        entityType = 'campaign';
        break;

      case 'upsert_workspace_template':
        entityId   = await upsertWorkspaceTemplate(db, tenantId, payload);
        entityType = 'workspace_template';
        break;

      case 'upsert_call_result':
        entityId   = await upsertCallResult(db, tenantId, payload);
        entityType = 'call_result';
        extra = { schemaValid: payload.schemaValid === true };
        break;

      case 'insert_enrichment_records':
        entityId   = await insertEnrichmentRecords(db, tenantId, payload);
        entityType = 'enrichment_record';
        break;

      case 'upsert_sequence':
        entityId   = await upsertSequence(db, tenantId, payload);
        entityType = 'sequence';
        break;

      case 'patch_tenant_config':
        if ('requestContext' in event && !isManagerOrAdmin(event as APIGatewayProxyEvent)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Only admins and managers can edit brand voice' }) };
        }
        entityId   = await patchTenantConfig(db, tenantId, payload);
        entityType = 'tenant';
        break;

      case 'set_tenant_billing':
        if ('requestContext' in event) {
          return { statusCode: 403, body: JSON.stringify({ error: 'billing mutations require the billing service' }) };
        }
        if (req.actorId !== 'billing-service') {
          return { ok: false, error: 'set_tenant_billing: caller must identify as billing-service' };
        }
        entityId   = await setTenantBilling(db, tenantId, payload);
        entityType = 'tenant';
        extra = { tier: payload.tier };
        break;

      case 'create_invitation':
        // The API-facing RBAC (who may invite which role) lives in
        // invitation-service, which also mints the token and sends the mail.
        // Refusing API Gateway here means that path cannot be skipped.
        if ('requestContext' in event) {
          return { statusCode: 403, body: JSON.stringify({ error: 'invitations require the invitation service' }) };
        }
        if (req.actorId !== 'invitation-service') {
          return { ok: false, error: 'create_invitation: caller must identify as invitation-service' };
        }
        entityId   = await createInvitation(db, tenantId, payload);
        entityType = 'invitation';
        extra = { role: payload.role };
        break;

      case 'revoke_invitation':
        if ('requestContext' in event) {
          return { statusCode: 403, body: JSON.stringify({ error: 'invitations require the invitation service' }) };
        }
        if (req.actorId !== 'invitation-service') {
          return { ok: false, error: 'revoke_invitation: caller must identify as invitation-service' };
        }
        entityId   = await revokeInvitation(db, tenantId, payload);
        entityType = 'invitation';
        break;

      case 'consume_invitation': {
        if ('requestContext' in event) {
          return { statusCode: 403, body: JSON.stringify({ error: 'invitations are claimed during sign-up' }) };
        }
        if (req.actorId !== 'tenant-provisioner') {
          return { ok: false, error: 'consume_invitation: caller must identify as tenant-provisioner' };
        }
        const claimed = await consumeInvitation(db, tenantId, payload);
        // No row means no valid invitation — the caller must not grant a role.
        return { ok: true, id: claimed.id, role: claimed.role };
      }

      case 'save_thread': {
        // A Home thread belongs to a signed-in person. There is no agent path:
        // an agent has no `sub`, so it could only ever write an unowned thread.
        if (!('requestContext' in event)) {
          return { ok: false, error: 'save_thread: requires a signed-in user' };
        }
        const saved = await saveThread(db, tenantId, subOf(event as APIGatewayProxyEvent), payload);
        return { ok: true, id: saved.id, appended: saved.appended };
      }

      case 'archive_thread': {
        if (!('requestContext' in event)) {
          return { ok: false, error: 'archive_thread: requires a signed-in user' };
        }
        entityId   = await archiveThread(db, tenantId, subOf(event as APIGatewayProxyEvent), payload);
        entityType = 'assistant_thread';
        break;
      }

      case 'save_sso_intent':
        if (!('requestContext' in event) || !isManagerOrAdmin(event as APIGatewayProxyEvent)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Only admins and managers can submit SSO metadata' }) };
        }
        entityId   = await saveSsoIntent(db, tenantId, payload);
        entityType = 'tenant';
        break;

      case 'patch_expansion_config':
        if (!('requestContext' in event) || !isManagerOrAdmin(event as APIGatewayProxyEvent)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Only admins and managers can set expansion flags' }) };
        }
        entityId   = await patchExpansionConfig(db, tenantId, payload);
        entityType = 'tenant';
        break;

      case 'erase_dsar':
        if (!('requestContext' in event) || !isManagerOrAdmin(event as APIGatewayProxyEvent)) {
          return { statusCode: 403, body: JSON.stringify({ error: 'Only admins and managers can erase a data subject' }) };
        }
        entityId   = await eraseDsar(db, tenantId, payload);
        entityType = 'contact';
        extra = { erased: true };
        break;

      case 'upsert_consent_record':
        entityId   = await upsertConsentRecord(db, tenantId, payload);
        entityType = 'consent_record';
        break;

      // ── Phase 7 support entities ──────────────────────────────────────────

      case 'upsert_conversation': {
        const p = payload;
        const r = await db.query(
          `INSERT INTO conversation (id, tenant_id, contact_id, channel_history, status, connect_contact_id)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, COALESCE($4,'[]')::jsonb, COALESCE($5,'open'), $6)
           ON CONFLICT (id) DO UPDATE SET
             channel_history   = EXCLUDED.channel_history,
             status            = EXCLUDED.status,
             first_response_at = CASE WHEN conversation.first_response_at IS NULL AND $5 != 'open'
                                      THEN NOW() ELSE conversation.first_response_at END,
             resolved_at       = EXCLUDED.resolved_at,
             updated_at        = NOW()
           RETURNING id`,
          [p.id ?? null, tenantId, p.contactId ?? null,
           p.channelHistory ? JSON.stringify(p.channelHistory) : null,
           p.status ?? 'open', p.connectContactId ?? null],
        );
        entityId = r.rows[0].id; entityType = 'conversation'; break;
      }

      case 'upsert_message': {
        const p = payload;
        const r = await db.query(
          `INSERT INTO message (id, tenant_id, conversation_id, channel, sender_type, sender_id,
             body, transcript_s3_key, sentiment_score)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [p.id ?? null, tenantId, p.conversationId, p.channel, p.senderType,
           p.senderId ?? null, p.body ?? null, p.transcriptS3Key ?? null,
           p.sentimentScore ?? null],
        );
        entityId = r.rows[0]?.id ?? (p.id as string); entityType = 'message'; break;
      }

      case 'upsert_ticket': {
        const p = payload;
        const r = await db.query(
          `INSERT INTO ticket (id, tenant_id, conversation_id, queue_id, tier, assigned_rep_id,
             priority, tags, sla_target_at, classification_reasoning)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, COALESCE($5,1), $6,
                   COALESCE($7,'normal'), COALESCE($8,'[]')::jsonb, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             queue_id                 = COALESCE(EXCLUDED.queue_id, ticket.queue_id),
             tier                     = EXCLUDED.tier,
             assigned_rep_id          = EXCLUDED.assigned_rep_id,
             priority                 = EXCLUDED.priority,
             sla_target_at            = COALESCE(EXCLUDED.sla_target_at, ticket.sla_target_at),
             sla_breached_at          = EXCLUDED.sla_breached_at,
             classification_reasoning = EXCLUDED.classification_reasoning,
             updated_at               = NOW()
           RETURNING id`,
          [p.id ?? null, tenantId, p.conversationId, p.queueId ?? null,
           p.tier ?? null, p.assignedRepId ?? null, p.priority ?? null,
           p.tags ? JSON.stringify(p.tags) : null,
           p.slaTargetAt ?? null, p.classificationReasoning ?? null],
        );
        entityId = r.rows[0].id; entityType = 'ticket'; break;
      }

      case 'upsert_rep_status': {
        const p = payload;
        await db.query(
          `INSERT INTO rep_status (rep_id, tenant_id, status, concurrent_ticket_count, updated_at)
           VALUES ($1, $2, $3, COALESCE($4,0), NOW())
           ON CONFLICT (rep_id, tenant_id) DO UPDATE SET
             status                  = EXCLUDED.status,
             concurrent_ticket_count = EXCLUDED.concurrent_ticket_count,
             updated_at              = NOW()`,
          [p.repId, tenantId, p.status ?? 'offline', p.concurrentTicketCount ?? null],
        );
        entityId = p.repId as string; entityType = 'rep_status'; break;
      }

      case 'upsert_macro': {
        const p = payload;
        const r = await db.query(
          `INSERT INTO macro (id, tenant_id, title, body_template, tags)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, COALESCE($5,'[]')::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title, body_template = EXCLUDED.body_template,
             tags = EXCLUDED.tags, updated_at = NOW()
           RETURNING id`,
          [p.id ?? null, tenantId, p.title, p.bodyTemplate,
           p.tags ? JSON.stringify(p.tags) : null],
        );
        entityId = r.rows[0].id; entityType = 'macro'; break;
      }

      case 'upsert_knowledge_article': {
        const p = payload;
        const r = await db.query(
          `INSERT INTO knowledge_article (id, tenant_id, title, body, status, version,
             embedding_ref, tags, last_reviewed_at)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, COALESCE($5,'draft'),
                   COALESCE($6,1), $7, COALESCE($8,'[]')::jsonb, $9)
           ON CONFLICT (id) DO UPDATE SET
             title            = EXCLUDED.title,
             body             = EXCLUDED.body,
             status           = EXCLUDED.status,
             version          = knowledge_article.version + 1,
             embedding_ref    = EXCLUDED.embedding_ref,
             tags             = EXCLUDED.tags,
             last_reviewed_at = EXCLUDED.last_reviewed_at,
             updated_at       = NOW()
           RETURNING id`,
          [p.id ?? null, tenantId, p.title, p.body, p.status ?? null,
           p.version ?? null, p.embeddingRef ?? null,
           p.tags ? JSON.stringify(p.tags) : null, p.lastReviewedAt ?? null],
        );
        entityId = r.rows[0].id; entityType = 'knowledge_article'; break;
      }

      case 'resolve_conversation': {
        const p = payload;
        await db.query(
          `UPDATE conversation SET
             status      = COALESCE($1, 'resolved'),
             resolved_at = COALESCE($2::timestamptz, NOW()),
             updated_at  = NOW()
           WHERE id = $3 AND tenant_id = $4`,
          [p.status ?? null, p.resolvedAt ?? null, p.id, tenantId],
        );
        entityId = p.id as string; entityType = 'conversation'; break;
      }

      case 'update_csat_score': {
        const p = payload;
        await db.query(
          `UPDATE conversation SET
             csat_score       = $1,
             csat_captured_at = COALESCE($2::timestamptz, NOW()),
             updated_at       = NOW()
           WHERE id = $3 AND tenant_id = $4`,
          [p.csatScore, p.csatCapturedAt ?? null, p.conversationId, tenantId],
        );
        entityId = p.conversationId as string; entityType = 'conversation'; break;
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown operation: ${operation}` }) };
    }

    // Publish audit event to DynamoDB (non-blocking on success)
    await publishEvent({
      tenantId, entityType, entityId,
      eventType: operation === 'erase_dsar' ? 'deleted' : (payload.id ? 'updated' : 'created'),
      actorType: actorType as 'human' | 'agent',
      actorId,
      data: { ...payload, operation },
      // Flattened so appsync-publisher can read them without unmarshalling `data`.
      agentType: typeof payload.agentType === 'string' ? payload.agentType : undefined,
      status: typeof payload.status === 'string' ? payload.status : undefined,
    });

    if (entityType === 'activity') {
      const meta = (payload.metadata && typeof payload.metadata === 'object')
        ? payload.metadata as Record<string, unknown> : {};
      const awaiting = meta.status === 'awaiting_approval';
      if (!awaiting && (payload.type === 'email' || payload.type === 'sms')) {
        await recordFirstActivation(tenantId, 'first_outbound_sent', {
          activityId: entityId, type: payload.type,
        });
      }
      if (payload.type === 'call') {
        await recordFirstActivation(tenantId, 'first_call_placed', {
          activityId: entityId,
        });
      }
    }

    return { ok: true, id: entityId, result: extra };

  } catch (err) {
    // If it's an OCC error from DSQL, surface it so callers can retry
    const msg = (err as Error).message;
    if (msg?.includes('OCC') || msg?.includes('concurrent')) {
      return { ok: false, error: `OCC_CONFLICT: ${msg}` };
    }
    console.error('CRM write error', { operation, error: msg });
    return { ok: false, error: msg };
  }
};

// ── API Gateway proxy boundary ───────────────────────────────────────────────
// A Lambda PROXY integration requires {statusCode, headers, body}. The write
// operations return {ok, id} / {ok:false, error}; passed through the proxy
// unchanged that produces a 502 with nothing useful logged. dispatch() keeps
// its natural shape for direct agent invocation and this adapts it only when
// the caller was API Gateway.
//
// An OCC_CONFLICT is returned as 409, not 500: it means "retry", and the
// distinction matters because DSQL has no advisory locks, so callers are
// expected to retry rather than treat it as a failure.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-impulsoiq-tenant',
  'Content-Type': 'application/json',
};

function toProxyResponse(out: unknown) {
  if (out && typeof out === 'object' && 'statusCode' in (out as object)) {
    const r = out as { statusCode: number; body?: string; headers?: Record<string, string> };
    return { ...r, headers: { ...CORS_HEADERS, ...r.headers } };
  }
  const o = (out ?? {}) as { ok?: boolean; error?: string };
  let status = 200;
  if (o.ok === false) status = o.error?.includes('OCC_CONFLICT') ? 409 : 500;
  return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify(out ?? null) };
}

export const handler = async (event: unknown) => {
  const viaApiGateway = !!event && typeof event === 'object' && 'requestContext' in (event as object);
  const out = await (dispatch as (e: unknown) => Promise<unknown>)(event);
  return viaApiGateway ? toProxyResponse(out) : out;
};
