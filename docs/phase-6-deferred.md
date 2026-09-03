# Phase 6 — Deferred items

## 6A — Full Data & Search Layer (explicitly deferred)

Per product decision, the following are NOT being built at this time:

**OpenSearch Service** — hybrid lexical+semantic search. Deferred until workspace-expansion usage (AR note search, recruiting candidate search) demonstrates real need for filtered/lexical queries that S3 Vectors' pure-semantic recall cannot serve. Will be added as a second backend behind the same single `query_memory` tool interface.

**Multi-Region data residency** — Aurora DSQL's active-active multi-Region capability. Deferred until a specific enterprise tenant requires a contractual regional data residency commitment. DSQL's architecture supports this without application changes when activated.

*Revisit trigger:* first enterprise pilot tenant requests data residency OR first search use-case where semantic recall alone proves insufficient.

## 6E — AgentCore Payments (x402) — explicitly NOT adopted

Nothing in ImpulsoIQ's feature set requires an agent to autonomously spend money on the tenant's behalf. Every metered cost (enrichment lookups, CALL-E call-minutes) is checked against a pre-approved allotment (Phase 3C metering pipeline), not agent-initiated purchasing.

This decision is recorded here explicitly so it is not reached for later without a deliberate architectural review.
