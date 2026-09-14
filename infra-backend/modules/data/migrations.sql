-- ── One-time data migrations (DML) ───────────────────────────────────────────
--
-- WHY THIS FILE IS SEPARATE FROM schema.sql
-- schema.sql is idempotent DDL: re-running it is a no-op, which is what makes
-- it safe in a pipeline. DML is not like that. The migrate stage runs on EVERY
-- backend deploy, so a bare `UPDATE tenant SET tier = 'free'` would re-run
-- forever and demote a customer every time they upgraded.
--
-- HOW "RUN ONCE" IS ENFORCED
-- A ledger table records the id of each applied migration, and every statement
-- is guarded by `NOT EXISTS (SELECT 1 FROM schema_migration WHERE id = ...)`.
-- After the first successful run the ledger row exists, so the guard makes each
-- statement match zero rows. That is pure SQL on purpose: Aurora DSQL has no
-- PL/pgSQL, no DO blocks and no triggers, so there is nowhere to put procedural
-- "if not applied then" logic.
--
-- RULES FOR ADDING A MIGRATION
--   1. Never edit or re-use an id — add a new one.
--   2. Keep the guard on every statement of the migration.
--   3. Write it so that running it twice would still be harmless. The ledger is
--      the safety net, not the only defence.
--   4. Aurora DSQL caps a transaction at 3,000 modified rows, and psql
--      autocommit gives each statement its own transaction. A migration that
--      could touch more rows than that must be chunked.

CREATE TABLE IF NOT EXISTS schema_migration (
  id         TEXT        PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2026-09-14-free-tier-backfill ────────────────────────────────────────────
-- Phase 5A makes Free a real tier. Clusters created before it defaulted every
-- workspace to 'starter', so existing tenants sit on a paid tier they never
-- bought. Move them to 'free'.
--
-- The Stripe guard is deliberate: a tenant that has actually paid has
-- config.stripeSubscriptionId set by billing-service, and must keep its tier.
-- So even if this ran again with the ledger wiped, it could only ever demote
-- workspaces with no subscription.
UPDATE tenant
   SET tier       = 'free',
       updated_at = NOW()
 WHERE tier = 'starter'
   AND COALESCE(config->>'stripeSubscriptionId', '') = ''
   AND NOT EXISTS (
     SELECT 1 FROM schema_migration WHERE id = '2026-09-14-free-tier-backfill'
   );

INSERT INTO schema_migration (id)
VALUES ('2026-09-14-free-tier-backfill')
ON CONFLICT (id) DO NOTHING;
