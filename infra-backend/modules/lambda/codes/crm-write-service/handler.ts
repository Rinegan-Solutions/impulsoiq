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
import { publishEvent } from './events';

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

async function upsertAgentRun(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const res = await db.query(
    `INSERT INTO agent_run (id, tenant_id, campaign_id, contact_id, agent_type,
       status, step_functions_execution_arn, input, started_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5,
             COALESCE($6,'pending'), $7, COALESCE($8,'{}')::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       status                       = EXCLUDED.status,
       step_functions_execution_arn = EXCLUDED.step_functions_execution_arn,
       output   = CASE WHEN $9::jsonb IS NOT NULL THEN $9::jsonb ELSE agent_run.output END,
       error    = COALESCE($10, agent_run.error),
       ended_at = CASE WHEN $6 IN ('completed','failed') THEN NOW() ELSE agent_run.ended_at END
     RETURNING id`,
    [p.id ?? null, tenantId, p.campaignId ?? null, p.contactId, p.agentType,
     p.status ?? null, p.stepFunctionsExecutionArn ?? null,
     p.input ? JSON.stringify(p.input) : null,
     p.output ? JSON.stringify(p.output) : null,
     p.error ?? null],
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

async function upsertCallResult(db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never, tenantId: string, p: Record<string, unknown>) {
  const res = await db.query(
    `INSERT INTO call_result (id, tenant_id, agent_run_id, contact_id, call_id,
       idempotency_key, outcome, duration_seconds, transcript_s3_key, summary_json,
       schema_valid, occurred_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9,
             $10::jsonb, $11, COALESCE($12, NOW()))
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [p.id ?? null, tenantId, p.agentRunId ?? null, p.contactId, p.callId,
     p.idempotencyKey, p.outcome, p.durationSeconds ?? null,
     p.transcriptS3Key ?? null,
     p.summaryJson ? JSON.stringify(p.summaryJson) : null,
     p.schemaValid ?? null, p.occurredAt ?? null],
  );
  return (res.rows[0]?.id ?? p.id) as string;
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
  // tenantId IS the row's id for tenant creation (first-class identifier).
  // (xmax = 0) is true for fresh inserts — lets the caller know if this is a new workspace.
  const res = await db.query(
    `INSERT INTO tenant (id, name, subdomain, email_domain, tier, config)
     VALUES ($1, $2, $3, $4, COALESCE($5,'starter'), COALESCE($6,'{}')::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name         = EXCLUDED.name,
       email_domain = COALESCE(EXCLUDED.email_domain, tenant.email_domain),
       tier         = EXCLUDED.tier,
       config       = EXCLUDED.config,
       updated_at   = NOW()
     RETURNING id, (xmax = 0) AS was_inserted`,
    [tenantId, p.name ?? tenantId, p.subdomain ?? tenantId, p.emailDomain ?? null,
     p.tier ?? null, p.config ? JSON.stringify(p.config) : null],
  );
  return res.rows[0] as { id: string; was_inserted: boolean };
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
        return { ok: true, id: entityId, wasInserted: tenantResult.was_inserted };

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
      eventType: payload.id ? 'updated' : 'created',
      actorType: actorType as 'human' | 'agent',
      actorId,
      data: { ...payload, operation },
    });

    return { ok: true, id: entityId };

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
