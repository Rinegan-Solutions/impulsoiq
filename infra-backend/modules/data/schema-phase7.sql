-- ═════════════════════════════════════════════════════════════════════
-- PHASE 7 — Contact Center Foundation
-- Apply with: psql ... -f schema-phase7.sql
-- ═════════════════════════════════════════════════════════════════════
--
-- Anchor entity: CONVERSATION (not ticket). A customer who emails Monday
-- and calls Wednesday about the same issue is ONE conversation with a
-- channel_history spanning both channels. (v4 §7B design note)
--
-- Amazon Connect provides telephony/chat transport + Contact Lens analytics.
-- Triage & Escalation Agent is the reasoning layer (invoked from Connect
-- Contact Flows via Lambda) — not Q in Connect, so every classification
-- goes through the same Control Panel, Evaluations, and Cedar policy as
-- every other agent decision. (v4 §7A architectural decision)

-- ── SLA policy ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_policy (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     TEXT        NOT NULL REFERENCES tenant(id),
  name                          TEXT        NOT NULL,
  first_response_target_minutes INTEGER     NOT NULL DEFAULT 60,
  resolution_target_minutes     INTEGER     NOT NULL DEFAULT 480,
  breach_escalation_rule        JSONB       NOT NULL DEFAULT '{}',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sla_policy_tenant ON sla_policy(tenant_id);

-- ── Support queue ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL REFERENCES tenant(id),
  name            TEXT        NOT NULL,
  required_skills JSONB       NOT NULL DEFAULT '[]',
  sla_policy_id   UUID        REFERENCES sla_policy(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_queue_tenant ON support_queue(tenant_id);

-- ── Conversation ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          TEXT        NOT NULL REFERENCES tenant(id),
  contact_id         UUID        REFERENCES contact(id),
  channel_history    JSONB       NOT NULL DEFAULT '[]',
  status             TEXT        NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','pending','resolved','closed')),
  connect_contact_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_response_at  TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ,
  csat_score         NUMERIC(3,1) CHECK (csat_score BETWEEN 1.0 AND 5.0),
  csat_captured_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_conversation_tenant  ON conversation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_contact ON conversation(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversation_status  ON conversation(tenant_id, status);

-- ── Message ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL REFERENCES tenant(id),
  conversation_id   UUID        NOT NULL REFERENCES conversation(id),
  channel           TEXT        NOT NULL
                      CHECK (channel IN ('email','chat','sms','voice','social')),
  sender_type       TEXT        NOT NULL
                      CHECK (sender_type IN ('customer','human_rep','agent')),
  sender_id         TEXT,
  body              TEXT,
  transcript_s3_key TEXT,
  sentiment_score   NUMERIC(4,3)
                      CHECK (sentiment_score BETWEEN -1.0 AND 1.0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_conversation ON message(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_tenant       ON message(tenant_id, created_at DESC);

-- ── Ticket ────────────────────────────────────────────────────────────
-- tier: 0=auto-resolve  1=draft-review  2=human-required  3=hard-escalate
-- Tier 3 escalation is a ROUTING RULE enforced by Cedar policy —
-- never left to agent discretion. (v4 §7C)
CREATE TABLE IF NOT EXISTS ticket (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                TEXT        NOT NULL REFERENCES tenant(id),
  conversation_id          UUID        NOT NULL UNIQUE REFERENCES conversation(id),
  queue_id                 UUID        REFERENCES support_queue(id),
  tier                     INTEGER     NOT NULL DEFAULT 1 CHECK (tier IN (0,1,2,3)),
  assigned_rep_id          TEXT,
  priority                 TEXT        NOT NULL DEFAULT 'normal'
                             CHECK (priority IN ('low','normal','high','urgent')),
  tags                     JSONB       NOT NULL DEFAULT '[]',
  sla_target_at            TIMESTAMPTZ,
  sla_breached_at          TIMESTAMPTZ,
  classification_reasoning TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_tenant ON ticket(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ticket_queue  ON ticket(queue_id);
CREATE INDEX IF NOT EXISTS idx_ticket_rep    ON ticket(tenant_id, assigned_rep_id);
CREATE INDEX IF NOT EXISTS idx_ticket_sla    ON ticket(tenant_id, sla_target_at)
  WHERE sla_breached_at IS NULL;

-- ── Rep status ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rep_status (
  rep_id                  TEXT        NOT NULL,
  tenant_id               TEXT        NOT NULL REFERENCES tenant(id),
  status                  TEXT        NOT NULL DEFAULT 'offline'
                            CHECK (status IN ('available','busy','offline')),
  concurrent_ticket_count INTEGER     NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rep_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_rep_status_tenant ON rep_status(tenant_id, status);

-- ── Macro ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS macro (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL REFERENCES tenant(id),
  title         TEXT        NOT NULL,
  body_template TEXT        NOT NULL,
  tags          JSONB       NOT NULL DEFAULT '[]',
  usage_count   INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_macro_tenant ON macro(tenant_id);

-- ── Knowledge article ─────────────────────────────────────────────────
-- embedding_ref points to S3 Vectors (same embed-on-write pipeline as
-- contact enrichment memory). Built in Phase 7, consumed by Resolution
-- Agent in Phase 8 for grounded citation-backed answers.
CREATE TABLE IF NOT EXISTS knowledge_article (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT        NOT NULL REFERENCES tenant(id),
  title            TEXT        NOT NULL,
  body             TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','published','deprecated')),
  version          INTEGER     NOT NULL DEFAULT 1,
  embedding_ref    TEXT,
  tags             JSONB       NOT NULL DEFAULT '[]',
  last_reviewed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_article_tenant ON knowledge_article(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_article_status ON knowledge_article(tenant_id, status);
