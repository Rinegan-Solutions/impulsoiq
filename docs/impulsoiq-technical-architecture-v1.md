# ImpulsoIQ — Technical Architecture Document (v1)

**Serverless, AgentCore-native, multi-tenant architecture for an agentic business workspace**

| | |
|---|---|
| **Document owner** | Blessyn |
| **Companion doc** | ImpulsoIQ PRD v3 (`impulsoiq-prd-v3.md`) |
| **Status** | v1 — pre-build architecture, informs hackathon MVP and production build |
| **Interim domain** | `{subdomain}.impulsoiq.rinegansolutions.com` (pre-`impulsoiq.com` acquisition) |
| **IaC** | Terraform + AWS CodePipeline (per existing AWS dev-ing standards) |

---

## 0. How to Read This Document

This is a working technical architecture, not a restatement of PRD §8. It answers the specific decisions raised during architecture brainstorming: agent topology, sync boundaries, memory design, data-write ownership, the MVP-vs-full-build cut line, CALL-E abstraction, data modeling against Aurora DSQL's actual current constraints, Terraform/AgentCore resource coverage, and subdomain tenancy including the pre-`impulsoiq.com` domain situation. Every decision below is written for two readers at once: the **product/UX owner**, who needs to know what a decision means for what the user sees and trusts, and the **engineer**, who needs to know what to actually provision.

---

## 1. Architectural Principles (Non-Negotiables)

1. **The agent's action is the unit of trust, not the record.** Every write an agent makes must be traceable to a specific `AgentRun`, a specific tool call, and a specific policy decision — this is not an audit feature bolted on later, it's why the write path is shaped the way it is (§6).
2. **One writer per record, many readers.** Specialist agents never write directly to the system of record. This is the single most important data-integrity decision in this document, and it's driven as much by Aurora DSQL's concurrency model as by audit cleanliness (§4.2).
3. **Consent is enforced in the tool-call path, not the application layer.** A Voice or Outreach agent cannot construct a valid outbound action without a passing consent check — this lives at the Gateway, not in a service that a future refactor could bypass.
4. **Tenant isolation is enforced twice: once at the edge (routing), once at the data layer (query scoping).** Never rely on the subdomain alone for isolation (§9).
5. **MVP and production share one architecture, not two.** The hackathon build is a true subset of the production system (fewer services turned on), never a parallel throwaway build (§11). This is the only way six weeks of hackathon work becomes real product equity.

---

## 2. System Context (C4 Level 1)

```
                                   ┌─────────────────────────┐
                                   │   Sales / RevOps User    │
                                   │  (browser, React SPA)    │
                                   └────────────┬─────────────┘
                                                │ HTTPS
                                   ┌────────────▼─────────────┐
                    ┌──────────────┤   CloudFront + WAF        ├──────────────┐
                    │              └────────────┬─────────────┘              │
             (static assets)             (API traffic)              (realtime subscriptions)
                    │                            │                            │
              ┌─────▼─────┐            ┌─────────▼─────────┐        ┌─────────▼─────────┐
              │  S3 (SPA)  │            │   API Gateway      │        │      AppSync       │
              └───────────┘            │  (REST + WS authz)  │        │  (GraphQL subs)    │
                                        └─────────┬─────────┘        └─────────┬─────────┘
                                                  │                            │
                                        ┌─────────▼─────────┐        ┌─────────▼─────────┐
                                        │  Lambda: CRUD,      │        │  DynamoDB Streams  │
                                        │  Auth, Webhooks,    │        │  → resolver fan-out │
                                        │  Campaign trigger    │        └─────────────────────┘
                                        └─────────┬─────────┘
                                                  │ invoke / event
                                        ┌─────────▼─────────┐
                                        │ AgentCore Runtime   │◄──── Gateway (MCP) ────┐
                                        │ (Coordinator +      │                        │
                                        │  specialist agents, │              ┌─────────┴─────────┐
                                        │  Graph orchestration)│              │  Tool targets:      │
                                        └─────────┬─────────┘              │  CRM write-service, │
                                                  │                        │  Enrichment APIs,    │
                                        ┌─────────▼─────────┐              │  CALL-E MCP,         │
                                        │  AgentCore Memory   │              │  Memory query tool   │
                                        │  + S3 Vectors (RAG) │              └─────────────────────┘
                                        └─────────────────────┘
                                                  │
                              ┌───────────────────┼───────────────────┐
                        ┌─────▼─────┐      ┌──────▼──────┐     ┌──────▼──────┐
                        │ Aurora DSQL│      │  DynamoDB    │     │  S3 (assets, │
                        │ (system of │      │ (events,     │     │  transcripts,│
                        │  record)   │      │  sessions,   │     │  archives)   │
                        └───────────┘      │  idempotency)│     └─────────────┘
                                            └─────────────┘
```

---

## 3. Agent Topology — Graph, With a Narrow Swarm Exception

**Decision: Graph pattern by default, for every campaign type shipped at MVP. Swarm reserved for one specific, bounded future use case — open-ended account research — and not built until there's a concrete need.**

### 3.1 Why Graph wins for this product, specifically

Graph orchestration means the Coordinator agent executes a **predefined, directed sequence of specialist-agent steps** (enrich → draft → send → wait → escalate-or-continue), where the plan structure is fixed even though each step's *content* is generated dynamically by the LLM. This is the right default for ImpulsoIQ for three reasons that compound:

- **Auditability.** The Control Panel (PRD §7.3) needs to show a user *what will happen next*, not just what already happened. A Graph's plan is inspectable before execution starts — a Swarm's negotiated plan is only knowable after agents have already begun talking to each other.
- **Cost predictability.** Swarm's collaborative negotiation between agents burns tokens on inter-agent coordination that Graph doesn't need. Given that inference cost is real COGS here (PRD §5.1, §13), Graph is the cheaper pattern per completed campaign, not just architecturally simpler — this directly matches your own instinct.
- **Compliance gating is a graph edge.** A consent check, an approval gate, a calling-window check (PRD §11 FR-10, FR-11) are all naturally modeled as conditional edges in a graph ("if consent == true, proceed to Voice agent; else, log block and end"). In a Swarm, you'd have to enforce the same gate independently inside every agent that might decide to act — much easier to get wrong.

### 3.2 The graph, concretely

```
[Goal Intake] → [Clarification Agent] → [Coordinator: build plan]
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
          [Research/Enrichment]      [Consent Gate Check]      [Cost/Scope Estimate]
                    │                         │                         │
                    └─────────────┬───────────┴─────────────────────────┘
                                  ▼
                    [Human Approval Gate?] ──(if configured)──► [Wait for approval]
                                  │
                                  ▼
                         [Outreach Agent: draft]
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                            ▼
          [Send: Email/SMS]              [Voice Agent: call via CALL-E]
                    │                            │
                    └─────────────┬──────────────┘
                                  ▼
                        [Write structured outcome
                         → single-writer path]
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                            ▼
        [Ambiguous / negative?]          [Clear outcome]
                    │                            │
                    ▼                            ▼
        [Escalate to human queue]      [Nurture Agent: schedule
                                          next touch or close loop]
```

Every diamond (decision point) above is a policy check enforced at the Gateway or AgentCore Policy layer, not agent judgment — an agent can *recommend* escalation, but the hard gates (consent, approval, calling window) are evaluated independently of what the LLM "decides."

### 3.3 When Swarm would actually earn its keep

Only for a genuinely open-ended, no-fixed-shape task: "find and qualify companies that look like our best current customers" (PRD §4.3), where the right *sequence* of research isn't known in advance and multiple research strategies might usefully run in parallel and cross-pollinate. This is explicitly **not** in MVP scope (§11) and shouldn't be built speculatively — Graph handles 100% of the hackathon and Phase 1 feature set.

---

## 4. Sync Boundaries and the Single-Writer Pattern

### 4.1 Voice agent: async by design, not blocking

**Decision: the Coordinator never blocks on a live call.** `run_call` (or `POST /v1/calls`) is fired with an idempotency key, the graph transitions to a `waiting_on_call` state, and the Coordinator's execution *pauses* (durable wait, not a held connection) until CALL-E's webhook delivers the terminal result to the event bus, which resumes the graph at that node.

Why this matters concretely: a qualification call might take 30 seconds or ring out after 45 — but a batch of 200 calls scheduled across a calling window might span hours. A synchronous, blocking design would require an AgentCore Runtime session to stay alive (and billing) for the full duration for no computational reason. Async resume is both the cost-correct and the architecturally-correct choice.

**Mechanism:**
- Step Functions (or AgentCore's own durable execution, where the graph step supports it) holds the "waiting for call result" state.
- CALL-E's `POST /calle/webhook` lands on API Gateway → Lambda → validates the idempotency key against the DynamoDB idempotency table → publishes a `CallCompleted` event to EventBridge.
- EventBridge rule resumes the specific graph execution keyed by `workflow_run_id` (already threaded through as CALL-E call `metadata`, per its API shape).
- The specialist Voice agent's node then runs the schema-validation check (FR-5, FR-9 reliability SLO) before handing the structured result to the single writer (§4.2).

### 4.2 Single-writer pattern for Aurora DSQL

**Decision: specialist agents (Research, Outreach, Voice, Nurture) never hold a DSQL connection or issue a write themselves. All writes to the system of record go through one internal service — the CRM Write Service — invoked as a Gateway tool.**

This was already the right instinct from a pure audit-cleanliness standpoint, but Aurora DSQL's specific concurrency model makes it close to mandatory, not just good practice:

- DSQL uses **optimistic concurrency control (OCC)**, not locking. Every transaction runs against a snapshot and is validated at commit; conflicting concurrent writers get a *retry*, not a queue. If five specialist agents across five parallel campaign executions all tried to write to the same `Contact` row directly (e.g., all updating `last_contacted_at`), you'd see OCC retry storms — exactly the "high write-contention" failure pattern AWS's own DSQL guidance calls out as the wrong workload shape for DSQL.
- Routing all writes through one CRM Write Service lets that service **serialize writes per entity** (a per-`contact_id` in-process or SQS-FIFO-backed queue) before they ever reach DSQL — converting what would be five racing OCC transactions into five sequential, cheap ones. This is the concrete mechanism, not just an audit nicety.
- It also gives you exactly one place to enforce tenant-scoping (§9.3) and exactly one place the audit-event emission (§6) can never be forgotten, because it's structurally impossible to write to Aurora DSQL any other way in this system.

**Consequence for the graph (§3.2):** every terminal node in the campaign graph ends the same way — "write structured outcome via CRM Write Service" — regardless of which specialist agent produced the outcome. This uniformity is what makes the Control Panel's timeline (PRD §7.3) trivially consistent: agent-authored and human-authored activity really are structurally identical, because they go through the identical write path.

---

## 5. Memory Architecture — One RAG Layer, Not Five

**Decision: a single "memory" tool exposed via AgentCore Gateway, backed by two stores underneath — AgentCore Memory for structured/session recall, S3 Vectors for semantic recall over unstructured content — with Bedrock Titan embeddings as the write-time bridge between them.**

### 5.1 Why one tool, two stores, not two tools

If each specialist agent queried AgentCore Memory and S3 Vectors independently, you'd end up with five slightly different retrieval strategies (five different top-k choices, five different re-ranking heuristics, five different ideas of "recent enough to matter") — a maintenance and quality-drift problem down the line, and it also means five separate places a bug could leak one tenant's data into another tenant's retrieval results. A single Gateway-exposed `query_memory(entity_id, query, k)` tool means:

- One retrieval strategy to tune, test, and improve.
- One place tenant-scoping is enforced for memory reads (mirrors the single-writer principle in §4.2, applied to reads).
- Agents get a simpler, smaller tool surface — better for tool-selection accuracy in the LLM's reasoning loop.

### 5.2 What lives where

| Store | Content | Access pattern |
|---|---|---|
| **AgentCore Memory — session/short-term** | In-flight campaign context, current plan state, conversation-turn history within a single agent run | Read/write by the running graph execution only; expires per session policy |
| **AgentCore Memory — long-term structured** | Per-contact/account facts: last outcome, preferred contact time, do-not-call flags, relationship stage — the kind of fact an agent should recall without re-deriving it | Written by CRM Write Service alongside the DSQL write (same transOverview boundary conceptually — see note below); read by any agent via the memory tool |
| **S3 Vectors** | Embedded, chunked unstructured content: call transcripts, email bodies, notes — anything an agent might need to semantically recall ("has this contact ever mentioned budget constraints?") | Written asynchronously after an `Activity` is created (embed-on-write via a Lambda triggered off the DynamoDB event stream, §6); read via the same memory tool, merged with structured-memory results before returning to the calling agent |

**Note on write consistency:** the long-term structured memory write is *not* in the same transaction as the DSQL write — it's a best-effort follow-on write, because DSQL and AgentCore Memory are different systems and distributed transactions across them aren't worth the complexity for what is, functionally, a cache/recall layer rather than the system of record. If the memory write fails, the DSQL record (source of truth) is unaffected; a reconciliation job re-derives memory facts from DSQL periodically as a safety net.

### 5.3 Hybrid recall gap — flagged honestly

S3 Vectors gives you cost-efficient semantic (embedding) similarity search but **no native full-text/lexical search**. If a Research or Nurture agent needs "find every contact whose notes mention 'renewal' in the next 30 days" (a lexical/filtered query, not a semantic-similarity query), pure vector recall will under-perform. For MVP, this is an accepted gap (semantic recall covers the qualification/follow-up use cases well enough). If workspace-expansion personas (PRD §6.2 — AR, recruiting) surface a real need for hybrid lexical+semantic search, the addition is OpenSearch Serverless as a second memory-tool backend behind the same single tool interface — not a re-architecture, just a new branch inside `query_memory`.

---

## 6. Event & Audit Architecture

**Decision: DynamoDB single-table design as the append-only backbone for every agent action, decoupled from Aurora DSQL entirely.**

This was already the right call in the prior brainstorm, and DSQL's transaction-size limits (a hard cap around 10,000 modified rows and roughly 5-minute transaction duration, per current AWS guidance) reinforce it further: a high-volume, high-frequency append pattern like "log every tool call, every token count, every state transition" is exactly the workload DynamoDB is built for and DSQL is not.

**Shape:**
- Partition key: `tenant_id#entity_type#entity_id` (e.g., `t_042#agentrun#ar_88213`)
- Sort key: `timestamp#event_type`
- Streams enabled → feeds three consumers independently:
  1. **AppSync resolver fan-out** (§7) for live Control Panel updates
  2. **Cost/metering aggregation pipeline** (§8) for usage-vs-tier tracking
  3. **S3 Vectors embed-on-write pipeline** (§5.2) for transcript/note recall

This is a genuine example of one write producing three independent, decoupled downstream effects without the write path itself knowing or caring about any of them — which is the correct shape for an event-sourced audit backbone.

---

## 7. Real-Time Control Panel — AppSync

**Decision: AppSync GraphQL subscriptions over DynamoDB Streams, JS resolvers (not VTL) as the default, VTL only where a JS resolver genuinely can't express the mapping.**

AppSync JS resolvers (APPSYNC_JS runtime) are functionally closer to normal TypeScript than VTL, which matters for maintainability given the frontend is already a TypeScript codebase — reduces the "two different languages for one team to maintain" tax. Reserve VTL only for edge cases where a specific resolver behavior isn't yet supported in the JS runtime.

**Resolver discipline (already flagged, restated as a hard rule):** resolvers map DynamoDB Stream records to GraphQL subscription payloads and do field-level shaping only. No business logic (e.g., "should this event be visible to this user's role") lives in a resolver — that's evaluated once, upstream, when the event is written (an `visible_to_roles` field is stamped onto the event at write time by the CRM Write Service / agent-action logger), so the resolver's job is purely mechanical.

---

## 8. Usage Metering & Subscription-Tier Enforcement

**Decision: a dedicated metering pipeline, separate from the audit event stream, even though both originate from the same DynamoDB Streams source.**

Every billable unit (an LLM call's token count, an enrichment lookup, a CALL-E call-minute) is tagged on its audit event at write time with a `metering: { type, quantity, tenant_id }` block. A Lambda consumer aggregates these into per-tenant, per-billing-period counters in a small dedicated DynamoDB table (`tenant_id#period` partition, running totals per usage type). This table is checked **synchronously, before action**, not just reported after the fact:

- Before the Voice agent's graph node calls CALL-E, it checks remaining call-minute allotment for the tenant's tier (PRD §13). If exhausted, the graph branches to a "notify user, do not call" terminal node rather than the call attempt itself failing downstream — cheaper and cleaner than a rejected API call.
- This same table powers the Control Panel's cost dashboard (PRD §7.3) directly — it's the same data, not a separate reporting rebuild.

---

## 9. Multi-Tenancy and Subdomain Architecture

### 9.1 Isolation model: pooled compute, tenant-scoped data, edge-routed presentation

Given the workspace-expansion ambitions (PRD §2.2) and the cost sensitivity already expressed (DSQL, S3 Vectors), a **pooled, silo-scoped-by-row** model is the right default over full silo-per-tenant infrastructure: shared AgentCore Runtime, shared DSQL cluster, shared DynamoDB tables — every tenant-scoped table carries a `tenant_id` partition/column, and isolation is enforced at three independent layers so no single bug is a full breach:

1. **Edge (routing only, not security):** CloudFront Function resolves `{subdomain}` → `tenant_id` via a small lookup (cached at the edge), sets `X-Tenant-Id`. This determines *where the request goes*, not *what it's allowed to see*.
2. **AuthN/AuthZ (the actual enforcement):** the Lambda authorizer validates the JWT's `tenant_id` claim against the `X-Tenant-Id` header — a mismatch is rejected before it reaches any business logic. The subdomain never grants access on its own.
3. **Data layer (defense in depth):** every DSQL query issued by the CRM Write Service is parameterized with `tenant_id` from the authenticated context (never from client input), and every DynamoDB partition key is prefixed with `tenant_id`. A bug in layer 2 still can't cross tenants because layer 3 doesn't trust the request to say which tenant it is — it trusts only the authenticated session.

### 9.2 Do you need a hosted zone for `impulsoiq.rinegansolutions.com`? — Yes, and here's the precise mechanism

Since `rinegansolutions.com` is presumably already registered and its DNS is managed somewhere (Route 53 or another provider), you have two clean options, and the right one depends on where `rinegansolutions.com`'s zone currently lives:

**Option A — `rinegansolutions.com` is already in Route 53 (same or different AWS account).**
Create a **new public hosted zone** for `impulsoiq.rinegansolutions.com` specifically (not for the whole `rinegansolutions.com` domain). Route 53 gives this new zone its own 4 NS records. You then add an **NS record for `impulsoiq.rinegansolutions.com`** inside the *existing* `rinegansolutions.com` hosted zone, pointing to those 4 name servers. This is the standard subdomain-delegation pattern — it delegates authority for everything under `impulsoiq.rinegansolutions.com` (including `*.impulsoiq.rinegansolutions.com` for tenant subdomains) to the new zone, without touching any other record in the parent zone. If the ImpulsoIQ AWS account is different from wherever `rinegansolutions.com` currently lives, this is exactly the **cross-account subdomain delegation** pattern — same mechanism, NS records copied across the account boundary instead of within one account.

**Option B — `rinegansolutions.com` is managed outside Route 53 (e.g., another registrar/DNS provider).**
Same first step (create the `impulsoiq.rinegansolutions.com` hosted zone in Route 53, get its 4 NS records), but instead of adding an NS record inside a Route 53 parent zone, you add that NS record set through whatever DNS provider currently hosts `rinegansolutions.com`'s zone (their control panel, not Route 53's). Functionally identical result — Route 53 becomes authoritative for everything under `impulsoiq.rinegansolutions.com` — just configured from the other provider's side. AWS's own guidance is explicit that this does **not** require migrating the parent `rinegansolutions.com` domain's DNS to Route 53 at all.

Either way: **one hosted zone, one wildcard record inside it** (`*.impulsoiq.rinegansolutions.com` → CloudFront distribution via an alias record), which is what makes every tenant subdomain (`acme.impulsoiq.rinegansolutions.com`, `contoso.impulsoiq.rinegansolutions.com`, …) resolve without provisioning a DNS record per tenant. Provisioning a new tenant is then a **data-layer operation only** (insert a row into the tenant lookup table used by the CloudFront Function, §9.1) — never a DNS change, which matters a lot for signup latency (PRD-adjacent product requirement: a new tenant subdomain should be live within seconds of signup, not after a DNS propagation wait).

**Wildcard TLS:** one ACM certificate for `*.impulsoiq.rinegansolutions.com` (DNS-validated using the same hosted zone), attached to the CloudFront distribution — this also means new tenants never wait on certificate issuance.

### 9.3 The `impulsoiq.com` migration cutover — plan it as a parallel-run, not a big-bang switch

When `impulsoiq.com` is acquired, the correct sequence is:

1. Register `impulsoiq.com`, create its Route 53 public hosted zone (this one *is* the domain's own zone, no delegation needed since you'll own the whole thing).
2. Provision `*.impulsoiq.com` in parallel — new wildcard ACM cert, new CloudFront alias, same origin/backend (API Gateway, AppSync, S3) the `rinegansolutions.com`-hosted version already points to. **The backend does not change; only the DNS name pointing at it does.** This means the cutover risk is entirely in DNS, not in application logic.
3. Update the tenant-subdomain resolution logic (§9.1's CloudFront Function) to accept **both** hostnames during a transition window — resolve `tenant_id` the same way regardless of which apex domain the request arrived on.
4. Update the JWT issuer / cookie domain configuration to be apex-agnostic during the transition (this is the part most likely to be forgotten and break sessions mid-cutover — cookies scoped to `.impulsoiq.rinegansolutions.com` will not carry over to `.impulsoiq.com` automatically).
5. Communicate the new canonical domain to existing tenants, default new-tenant provisioning to `impulsoiq.com` immediately, and 301-redirect the old `rinegansolutions.com` subdomains to their `impulsoiq.com` equivalents once you're confident in the new domain's stability — don't decommission `rinegansolutions.com` routing immediately; run both for a deprecation window (recommend 60–90 days) so any hard-coded bookmarks/integrations don't break outright.
6. Only after the deprecation window: remove the `rinegansolutions.com` delegation NS record (§9.2) and decommission that hosted zone.

This is a genuinely low-risk migration *specifically because* tenancy was designed edge-agnostic from day one (§9.1) — the apex domain was never load-bearing for tenant isolation, only for routing, so swapping it is a DNS and redirect exercise, not a re-architecture.

### 9.4 Unresolved edge case: unknown subdomain

Request to a subdomain with no matching tenant row: CloudFront Function should route to a **dedicated "not found / claim this workspace" Lambda@Edge-served page** that offers a path to the signup flow (matching your stated preference), rather than a bare 404 or a redirect to the marketing site — this converts a mistyped-URL dead end into a plausible signup entry point at near-zero engineering cost, since the routing infrastructure already has to make a decision here regardless.

---

## 10. Data Modeling Against Aurora DSQL's Actual Current Constraints

This section supersedes any assumption that Aurora DSQL is "just Postgres." As of the current DSQL release (checked directly against AWS's release notes and compatibility guidance), the feature surface has moved fast and materially changes what "best practice" means here versus a generic Postgres schema.

### 10.1 What DSQL supports today (and therefore what's safe to design around)

- **Foreign key constraints** — added recently; supported with `NO ACTION`, `RESTRICT`, `CASCADE`, `SET NULL`, `SET DEFAULT`, plus `MATCH FULL`/`MATCH SIMPLE` and deferrable constraints. **Use them** for the core entity graph (`Contact` → `Account`, `Deal` → `Account`, `Activity` → `Contact`) — this was previously the single biggest reason to avoid DSQL for a CRM-shaped schema, and it's no longer a blocker.
- **Identity columns / sequences** — supported (added earlier this year). Safe to use for surrogate keys, though see §10.3 on high-contention sequence-like patterns.
- **JSONB** — supported. Use for genuinely semi-structured fields (agent plan snapshots, CALL-E structured-result payloads with variable schema per campaign type) rather than modeling every possible field as a column.
- **Views** — supported since GA.
- **`SELECT ... FOR UPDATE` / `FOR KEY SHARE`** — supported, including multi-table `FOR UPDATE` without requiring equality predicates on every primary-key column. Useful for the single-writer service (§4.2) when it needs to read-then-write a specific row set.

### 10.2 What DSQL still does not support — hard constraints on schema design

- **No triggers, no stored procedures (PL/pgSQL).** Any logic you'd instinctively put in a trigger (e.g., "auto-update `last_contacted_at` when an `Activity` is inserted") must live in the CRM Write Service application code instead. This is actually consistent with the single-writer principle (§4.2) — there's one place that logic needs to exist anyway.
- **No advisory locks, no `LOCK TABLE`.** Any coordination pattern that would reach for these (e.g., "only one process may process this account's queue at a time") must be implemented via the idempotency/sequencing table pattern already planned for CALL-E (§4.2's per-entity write serialization) rather than a database-level lock.
- **No `SERIALIZABLE` isolation level** — DSQL's isolation is snapshot-based OCC, not the Postgres serializable level. Application logic that assumed serializable guarantees (rare, but check any imported logic/ORMs) needs re-verification.
- **Extensions are unsupported** — no PostGIS, no `pgvector`. This is precisely why vector search is delegated to S3 Vectors (§5) rather than attempted in-database — not a workaround, the architecturally correct split.
- **Transaction size/duration limits** — practical caps around 10,000 modified rows and multi-minute duration per transaction. **This directly constrains bulk operations**: a CSV import of 50,000 contacts, or a bulk re-enrichment sweep, must be chunked into multiple transactions by the CRM Write Service (batches of a few thousand rows, well under the limit), never issued as one large transaction. Design every bulk-write code path with explicit batching from day one — retrofitting this after a production incident is expensive.

### 10.3 High-write-contention avoidance — direct implication for CRM Write Service design

AWS's own DSQL guidance is explicit that high-contention patterns (many concurrent transactions modifying the *same* rows — a shared counter, a leaderboard, a single "total calls this month" row) generate high OCC retry rates and unpredictable throughput. Two concrete places this bites a CRM if not designed around:

- **Don't maintain a running aggregate row per tenant in DSQL** (e.g., a single `tenant_stats` row incremented on every activity). This is exactly the contention pattern to avoid. Aggregate counts belong in the DynamoDB metering pipeline (§8), which is built for high-frequency increments, or computed on-read from the event stream — never as a hot, frequently-written DSQL row.
- **The per-entity write serialization in the CRM Write Service (§4.2)** isn't just an audit-cleanliness choice — it's what prevents multiple concurrent agent graph executions from generating OCC retry storms against the same `Contact`/`Deal` rows in the first place. The single-writer pattern and DSQL's concurrency model reinforce each other; this is a case where the "obviously correct for auditability" answer and the "obviously correct for database performance" answer turned out to be the same answer.

### 10.4 Core schema sketch (illustrative, not exhaustive)

```
tenant                  (tenant_id PK, subdomain, tier, created_at, status)
account                 (account_id PK, tenant_id FK, name, domain, enrichment_json JSONB, ...)
contact                 (contact_id PK, tenant_id FK, account_id FK → account, email, phone,
                          consent_email, consent_sms, consent_voice, last_contacted_at, ...)
deal                    (deal_id PK, tenant_id FK, account_id FK → account, stage, value, ...)
activity                (activity_id PK, tenant_id FK, contact_id FK → contact,
                          type ENUM(email|sms|call|note|task|meeting), actor_type ENUM(human|agent),
                          agent_run_id FK → agent_run (nullable), payload JSONB, created_at)
call_result             (call_result_id PK, activity_id FK → activity UNIQUE,
                          call_e_call_id, outcome_schema_version, structured_result JSONB,
                          transcript_s3_key, connect_status, ...)
agent_run               (agent_run_id PK, tenant_id FK, campaign_id FK, goal_text, plan_json JSONB,
                          status, cost_tokens, cost_call_minutes, started_at, completed_at)
campaign                (campaign_id PK, tenant_id FK, playbook_id, target_segment, schedule, ...)
consent_record          (consent_id PK, tenant_id FK, contact_id FK → contact,
                          channel ENUM(email|sms|voice), status, legal_basis, jurisdiction, updated_at)
```

Notes: `activity`, `agent_run` metadata is intentionally kept in DSQL (it's the queryable, joinable system of record a rep or manager browses), while the *high-frequency, granular* event stream underneath each `agent_run` (every tool call, every token) lives in DynamoDB (§6) and is linked by `agent_run_id` — DSQL holds the summary, DynamoDB holds the firehose. This split is the direct schema-level expression of the "DSQL for system-of-record, DynamoDB for event volume" principle running through this whole document.

---

## 11. MVP-vs-Full-Build Cut Line

Explicit, so the hackathon build doesn't over-scope and doesn't under-invest in the wrong place.

| Layer | Hackathon MVP (by Sep 14) | Full production build |
|---|---|---|
| Agent orchestration | Graph pattern, single campaign type (SDR/AE qualification+follow-up) | Graph as default; Swarm added only if a concrete workspace-expansion need justifies it |
| AgentCore services used | Runtime, Memory, Gateway, Identity, Observability | + Policy/Evaluations (regression testing), potentially Browser (if Research agent needs page-scraping beyond API coverage) |
| Voice | CALL-E via MCP, single-call qualification + meeting-confirmation flows, synchronous demo-friendly path acceptable | Full async graph-pause/resume pattern (§4.1), batch/scheduled calling once CALL-E's own Phase 1 beta scope expands to cover it |
| Data layer | Aurora DSQL (core entities), single DynamoDB table (events), S3 (transcripts) | + S3 Vectors (semantic memory), full metering pipeline (§8), OpenSearch if hybrid search becomes necessary (§5.3) |
| Multi-tenancy | Can launch single-tenant or coarse multi-tenant for demo purposes | Full 3-layer isolation (§9.1), subdomain provisioning, wildcard cert |
| Real-time UI | Control Panel can use simple polling for demo if AppSync setup risks the timeline | Full AppSync subscription architecture (§7) |
| IaC | Terraform for the services actually demoed; manual console steps acceptable for anything not in the demo path | Full Terraform + CodePipeline coverage, no manual steps anywhere |

The rule of thumb: **cut breadth, never cut the auditability spine** (single-writer, event log, consent gating) — that spine is what makes the hackathon submission credible as a "real product experience" (a judging criterion on both hackathons) rather than a demo script, and it's also the part that's expensive to retrofit later.

---

## 12. CALL-E Abstraction

**Decision: wrap CALL-E behind an internal `VoiceProvider` interface from day one — not because CALL-E is untrustworthy, but because it's explicitly labeled Phase 1 beta with named gaps (batch calls, scheduled calls, and webhook management called out as outside current scope), and the cost of the abstraction is low.**

```
interface VoiceProvider {
  placeCall(goal: string, recipient: Recipient, resultSchema: JSONSchema,
            idempotencyKey: string, metadata: Record<string,string>): Promise<CallHandle>
  getCallStatus(callId: string): Promise<CallStatus>
  onCallCompleted(handler: (result: StructuredCallResult) => void): void  // webhook-backed
}
```

The Voice agent's graph node calls this interface, never the CALL-E SDK/MCP client directly. Today, `CalleVoiceProvider` is the only implementation. If CALL-E's beta status becomes a real operational risk (an outage, a scope gap that blocks a needed feature like true batch calling), a second implementation can be added without touching the graph, the Coordinator, or any other agent — this is a standard adapter pattern, made cheap here specifically because the interface surface (place a call, get structured result back) is small and stable even while the underlying provider's SDK is not.

---

## 13. IaC and CI/CD

Terraform, per existing standards, is confirmed viable for this stack: the `hashicorp/aws` provider (v6.18+; current is well past that) ships full `aws_bedrockagentcore_*` coverage — 21 resources including `agent_runtime`, `agent_runtime_endpoint`, `gateway`, `gateway_target`, `memory`, `memory_strategy`, `identity`/workload identity, `policy_engine`, `harness`, `browser`, `code_interpreter`, `evaluator`, and credential-provider resources. No CDK-only gap exists for the services this architecture actually uses (Runtime, Gateway, Memory, Identity, Observability).

**Two things to sequence into the Terraform build early, not late:**
- **ARM64-only constraint.** AgentCore Runtime requires ARM64 container images — the CodeBuild/CodePipeline image and build environment must target `ARM_CONTAINER`/`aarch64`, not the x86 default many pipelines assume. Get this right in the pipeline template before the first agent deploy, not after a failed build.
- **IAM scoping.** The broad `BedrockAgentCoreFullAccess` managed policy is fine for the earliest prototyping but should be replaced with least-privilege statements (scoped `bedrock:InvokeModel` etc.) before anything resembling production traffic — this is a Terraform variable flip (`attach_bedrock_fullaccess_policy = false` plus explicit `additional_iam_statements`), so plan the variable now even if MVP ships with the broad policy for speed.

Standard module layout: one module per bounded context (`agentcore/`, `data/` [DSQL + DynamoDB + S3], `networking/` [Route 53, CloudFront, ACM per §9], `api/` [API Gateway + AppSync], `frontend/`), composed in an environment root per your existing conventions, deployed via CodePipeline stages (plan → manual/auto approve → apply) per environment.

---

## 14. Summary of Decisions

| Decision | Choice | Primary driver |
|---|---|---|
| Agent topology | Graph (default), Swarm deferred | Auditability + cost predictability + compliance-as-graph-edges |
| Voice sync boundary | Async, webhook-resumed graph pause | Cost (no idle session billing) + correctness (calls take variable time) |
| Memory | One Gateway tool, two backends (AgentCore Memory + S3 Vectors) | Consistency, tenant-scoping in one place, simpler agent tool surface |
| Writes | Single CRM Write Service; specialist agents never write directly | Audit integrity + DSQL OCC-contention avoidance (same answer, two reasons) |
| Event/audit store | DynamoDB, decoupled from DSQL | High-frequency append workload; DSQL transaction-size limits |
| Real-time UI | AppSync + JS resolvers (VTL only as exception) | Maintainability (one language family with the frontend) |
| Metering | Separate pipeline off the same stream, checked pre-action | Tier enforcement must be synchronous, not just reported |
| Tenancy | Pooled compute/data, 3-layer isolation, subdomain-agnostic core | Cost efficiency + clean domain-migration path |
| Domain | Delegated hosted zone under `rinegansolutions.com` now, parallel-run cutover to `impulsoiq.com` later | Zero backend risk in the migration; only DNS/cookie config changes |
| Database | Aurora DSQL with FKs, JSONB, explicit batching, no triggers/advisory locks | Matches DSQL's actual current (2026) compatibility surface |
| CALL-E integration | Wrapped behind `VoiceProvider` interface | Beta-stage third-party dependency risk, cheap to hedge |
| IaC | Terraform, full AgentCore resource coverage confirmed | Matches existing team standards; no capability gap vs. CDK |

---

## 15. Open Items for Next Pass

1. Confirm whether MVP demo (six-week window) needs live AppSync or can ship with polling — a real timeline-risk call, not an architecture call.
2. Decide the deprecation-window length for `rinegansolutions.com` routing once `impulsoiq.com` is live (§9.3 recommends 60–90 days as a starting point).
3. Revisit S3 Vectors vs. OpenSearch hybrid-search gap (§5.3) once workspace-expansion personas (AR, recruiting) have real usage data to justify the added service.
4. Confirm the batching threshold (rows per transaction) for bulk-import/bulk-enrichment code paths against DSQL's current documented limits at implementation time, since this is an area AWS has been actively raising (per the recent precision/FK changes) — re-check before hardcoding a number.
