-- ImpulsoIQ — Aurora DSQL schema (Phase 1)
-- DSQL constraints: no triggers, no stored procedures, no advisory locks,
-- no SERIALIZABLE isolation, no extensions (pgvector excluded).
-- Supported: FK constraints, JSONB, gen_random_uuid(), identity columns.
-- Bulk writes must be chunked to ~10,000 rows per transaction.

-- ── Tenants ───────────────────────────────────────────────────────────────────
-- TENANT IDENTITY
-- id is the workspace SLUG, not a UUID, and it is the same value as:
--   * the Cognito custom:tenant_id claim
--   * the host label in <slug>.impulsoiq.rinegansolutions.com
--   * the tenant_id column on every other table
--
-- One value for all three is what makes subdomain isolation a string
-- comparison instead of a lookup on every request. It is also forced by
-- Cognito: custom:tenant_id is declared mutable = false, so it is fixed at
-- sign-up, before any tenant row exists to generate an id from -- there is no
-- point at which a server-generated UUID could be written back into the claim.
--
-- The CHECK is what keeps that safe. The slug reaches the database from a
-- user-supplied workspace name, and it becomes a DNS label, so it is
-- constrained to the intersection of both: lowercase alphanumerics and inner
-- hyphens, 2-40 characters. Reserved labels (www, app, api, ...) are rejected
-- separately at sign-up and at the edge.
CREATE TABLE IF NOT EXISTS tenant (
  id           TEXT        PRIMARY KEY
                 CHECK (id ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name         TEXT        NOT NULL,
  -- Mirrors id. Kept as its own column because org-check and the sign-up flow
  -- query by it, and because a future rename would change the subdomain
  -- without rewriting every foreign key.
  subdomain    TEXT        NOT NULL,
  email_domain TEXT,        -- e.g. "acmecorp.com" — used for org-detection during sign-up
  tier         TEXT        NOT NULL DEFAULT 'starter'
                 CHECK (tier IN ('starter','growth','enterprise')),
  config       JSONB       NOT NULL DEFAULT '{}',
  -- Phase 6D. Declared HERE, not added later: Aurora DSQL's ALTER TABLE ADD
  -- COLUMN grammar is `column_name data_type [STORAGE ...]` and nothing else,
  -- so NOT NULL and DEFAULT can only be set at CREATE TABLE time. The ALTERs
  -- further down exist solely to patch clusters created before this block.
  compliance_settings JSONB   NOT NULL DEFAULT '{}',
  sso_configured      BOOLEAN NOT NULL DEFAULT FALSE,
  sso_provider_id     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS idx_tenant_subdomain    ON tenant(subdomain);
CREATE        INDEX ASYNC IF NOT EXISTS idx_tenant_email_domain ON tenant(email_domain);

-- ── Accounts (companies) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL REFERENCES tenant(id),
  name            TEXT        NOT NULL,
  domain          TEXT,
  industry        TEXT,
  website         TEXT,
  employee_count  INTEGER,
  annual_revenue  NUMERIC(15,2),
  enrichment_json JSONB       NOT NULL DEFAULT '{}',
  custom_fields   JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_account_tenant  ON account(tenant_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_account_domain  ON account(tenant_id, domain);

-- ── Contacts ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL REFERENCES tenant(id),
  account_id      UUID        REFERENCES account(id),
  first_name      TEXT        NOT NULL,
  last_name       TEXT        NOT NULL,
  email           TEXT,
  phone           TEXT,
  title           TEXT,
  linkedin_url    TEXT,
  stage           TEXT        NOT NULL DEFAULT 'Prospecting'
                    CHECK (stage IN ('Prospecting','Qualified','Demo Booked',
                                     'Proposal','Negotiating','Closed Won')),
  score           INTEGER     NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  enrichment_json JSONB       NOT NULL DEFAULT '{}',
  custom_fields   JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_contact_tenant  ON contact(tenant_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_contact_account ON contact(account_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_contact_email   ON contact(tenant_id, email);
CREATE INDEX ASYNC IF NOT EXISTS idx_contact_stage   ON contact(tenant_id, stage);

-- ── Deals ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL REFERENCES tenant(id),
  account_id    UUID        NOT NULL REFERENCES account(id),
  contact_id    UUID        REFERENCES contact(id),
  name          TEXT        NOT NULL,
  amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  stage         TEXT        NOT NULL DEFAULT 'Prospecting'
                  CHECK (stage IN ('Prospecting','Qualified','Demo Booked',
                                   'Proposal','Negotiating','Closed Won')),
  probability   INTEGER     NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  close_date    DATE,
  custom_fields JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_deal_tenant  ON deal(tenant_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_deal_account ON deal(account_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_deal_stage   ON deal(tenant_id, stage);

-- ── Campaigns ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL REFERENCES tenant(id),
  name          TEXT        NOT NULL,
  type          TEXT        NOT NULL DEFAULT 'sdr_qualification',
  status        TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','paused','completed','cancelled')),
  config        JSONB       NOT NULL DEFAULT '{}',
  goal_template TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_campaign_tenant ON campaign(tenant_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_campaign_status ON campaign(tenant_id, status);

-- ── Agent Runs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_run (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   TEXT        NOT NULL REFERENCES tenant(id),
  campaign_id                 UUID        REFERENCES campaign(id),
  contact_id                  UUID        NOT NULL REFERENCES contact(id),
  agent_type                  TEXT        NOT NULL
                                CHECK (agent_type IN ('coordinator','clarification',
                                                      'research_enrichment','outreach',
                                                      'voice','nurture')),
  status                      TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','running','paused',
                                                  'completed','failed')),
  step_functions_execution_arn TEXT,
  input                       JSONB       NOT NULL DEFAULT '{}',
  output                      JSONB,
  error                       TEXT,
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at                    TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_agent_run_tenant   ON agent_run(tenant_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_agent_run_campaign ON agent_run(campaign_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_agent_run_contact  ON agent_run(contact_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_agent_run_status   ON agent_run(tenant_id, status);

-- ── Activities (human- and agent-authored — same table by design) ─────────────
CREATE TABLE IF NOT EXISTS activity (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL REFERENCES tenant(id),
  contact_id    UUID        REFERENCES contact(id),
  account_id    UUID        REFERENCES account(id),
  deal_id       UUID        REFERENCES deal(id),
  agent_run_id  UUID        REFERENCES agent_run(id),
  type          TEXT        NOT NULL
                  CHECK (type IN ('email','sms','call','note','task','meeting')),
  actor_type    TEXT        NOT NULL CHECK (actor_type IN ('human','agent')),
  actor_id      TEXT        NOT NULL,
  subject       TEXT,
  body          TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_activity_tenant    ON activity(tenant_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_activity_contact   ON activity(contact_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_activity_agent_run ON activity(agent_run_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_activity_occurred  ON activity(tenant_id, occurred_at);

-- ── Call Results ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_result (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL REFERENCES tenant(id),
  agent_run_id      UUID        REFERENCES agent_run(id),
  contact_id        UUID        NOT NULL REFERENCES contact(id),
  call_id           TEXT        NOT NULL,
  idempotency_key   TEXT        NOT NULL,
  outcome           TEXT        NOT NULL
                      CHECK (outcome IN ('answered','voicemail','no_answer','busy','failed')),
  duration_seconds  INTEGER,
  transcript_s3_key TEXT,
  summary_json      JSONB,
  schema_valid      BOOLEAN,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS idx_call_result_idempotency ON call_result(idempotency_key);
CREATE INDEX        ASYNC IF NOT EXISTS idx_call_result_tenant      ON call_result(tenant_id);
CREATE INDEX        ASYNC IF NOT EXISTS idx_call_result_contact     ON call_result(contact_id);

-- ── Workspace Templates (Phase 5) ────────────────────────────────────────────
-- Stores per-tenant activations of the 5 workspace templates.
-- The template DEFINITIONS live in coordinator/templates.py — only the tenant's
-- activation record (status, config overrides, legal review) lives here.
CREATE TABLE IF NOT EXISTS workspace_template (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL REFERENCES tenant(id),
  template_key      TEXT        NOT NULL,   -- 'recruiting_coordination', 'accounts_receivable', etc.
  name              TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'inactive'
                      CHECK (status IN ('active','inactive','pending_review')),
  config            JSONB       NOT NULL DEFAULT '{}', -- per-tenant overrides only
  legal_reviewed_by TEXT,                  -- 5B requires this before activation
  legal_reviewed_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, template_key)
);
CREATE INDEX ASYNC IF NOT EXISTS idx_workspace_template_tenant ON workspace_template(tenant_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_workspace_template_status ON workspace_template(tenant_id, status);

-- ── Consent Records (first-class entity — hard gate for ALL outbound comms) ───
-- ConsentRecord is NOT a flag on Contact. It is a separate, auditable entity.
-- Every outbound action (email/SMS/call) checks this table before executing.
CREATE TABLE IF NOT EXISTS consent_record (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT        NOT NULL REFERENCES tenant(id),
  contact_id  UUID        NOT NULL REFERENCES contact(id),
  channel     TEXT        NOT NULL CHECK (channel IN ('email','sms','call')),
  granted     BOOLEAN     NOT NULL,
  source      TEXT        NOT NULL,
  source_ref  TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One active consent record per contact/channel; upsert replaces existing.
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS idx_consent_contact_channel ON consent_record(tenant_id, contact_id, channel);
CREATE INDEX        ASYNC IF NOT EXISTS idx_consent_tenant           ON consent_record(tenant_id);

-- ── Phase 6B: AgentCore Registry ──────────────────────────────────────────────
-- Discoverable catalog of agents, tools, and templates for enterprise admins.
-- Populated by the registry-seeder Lambda on deploy; updated on version bumps.
CREATE TABLE IF NOT EXISTS agent_registry (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type        TEXT        NOT NULL CHECK (entry_type IN ('agent','tool','template')),
  key               TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  description       TEXT,
  version           TEXT        NOT NULL DEFAULT '1.0.0',
  capabilities      JSONB       NOT NULL DEFAULT '[]',
  input_schema      JSONB       NOT NULL DEFAULT '{}',
  output_schema     JSONB       NOT NULL DEFAULT '{}',
  phase_introduced  TEXT,
  status            TEXT        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','deprecated','experimental')),
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entry_type, key)
);
CREATE INDEX ASYNC IF NOT EXISTS idx_registry_type   ON agent_registry(entry_type, status);
CREATE INDEX ASYNC IF NOT EXISTS idx_registry_status ON agent_registry(status);

-- ── Phase 6D: Tenant compliance settings ──────────────────────────────────────
-- Per-tenant jurisdiction flags and SSO configuration.
-- Stored as a column on the existing tenant table.
-- Backfill for clusters created before those columns moved into CREATE TABLE
-- above. CREATE TABLE IF NOT EXISTS will not add columns to a table that
-- already exists, so this path is what upgrades them.
--
-- The grammar is unforgiving and is the reason this looks verbose. Aurora DSQL
-- supports exactly:
--     ADD [COLUMN] [IF NOT EXISTS] column_name data_type [STORAGE ...]
-- No NOT NULL, no DEFAULT, no CHECK, no UNIQUE, no REFERENCES. DEFAULT is set
-- afterwards as its own ALTER COLUMN action.
--
-- NOT NULL cannot be applied retrospectively at all: DSQL's ALTER TABLE has
-- DROP NOT NULL and no SET NOT NULL. On an upgraded cluster these columns stay
-- nullable, so application code must treat NULL and the default as equivalent
-- -- which is why crm-read/crm-write coalesce rather than assume.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS compliance_settings JSONB;
ALTER TABLE tenant ALTER COLUMN compliance_settings SET DEFAULT '{}';
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS sso_configured BOOLEAN;
ALTER TABLE tenant ALTER COLUMN sso_configured SET DEFAULT FALSE;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS sso_provider_id TEXT;

-- ── Phase 6C: A2A handoff log ──────────────────────────────────────────────────
-- Records cross-department agent handoff events for audit and observability.
CREATE TABLE IF NOT EXISTS a2a_handoff (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT        NOT NULL REFERENCES tenant(id),
  from_template    TEXT        NOT NULL,
  to_template      TEXT        NOT NULL,
  context_entity   TEXT        NOT NULL,  -- 'deal', 'contact', etc.
  context_id       UUID        NOT NULL,
  handoff_data     JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'initiated'
                     CHECK (status IN ('initiated','completed','failed')),
  initiated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_a2a_tenant   ON a2a_handoff(tenant_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_a2a_status   ON a2a_handoff(tenant_id, status);
