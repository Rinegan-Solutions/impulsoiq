# ImpulsoIQ — Implementation Plan (Phased): Agents, Features, and End-to-End Delivery

**Full enterprise scope, sequenced into build phases — mapped feature-by-feature to the agent(s) that deliver it, written against AWS's own "Professional Agents" definition**

| | |
|---|---|
| **Document owner** | Blessyn |
| **Companion docs** | PRD v3 (`impulsoiq-prd-v3.md`), Technical Architecture v1 (`impulsoiq-technical-architecture-v1.md`) |
| **Status** | v3 — phased plan, updated with lead-generation research findings (contact verification, signal-sourced discovery, model-tiering strategy) |
| **Sequencing basis** | Dependency order, not calendar dates — each phase's entry criteria are the prior phase's exit criteria |
| **Default agentic model** | Amazon Nova 2 Lite, extended thinking at **medium** reasoning effort, unless a specific agent calls for a different tier (see §5, Model Tiering Strategy) |

---

## 0. Changelog — v2 → v3

Three substantive additions came out of lead-generation research and are now integrated throughout, not bolted on as an appendix:

1. **Phase 2A (Research & Enrichment Agent) gains a fourth, fully-specified waterfall step** — executive mapping and contact verification, including a new third-party email-verification Gateway tool and an explicit preference for licensed data providers over direct scraping of gated networks (§Phase 2, 2A).
2. **A new agent — the Signal Listening Agent — is added in Phase 4**, responsible for continuous, unprompted lead *origination* (as opposed to Phase 2A's per-record *enrichment*), with its own cost-governance discipline modeled on Phase 4B's Swarm budget gating (§Phase 4, 4C).
3. **A new cross-cutting section, §5 Model Tiering Strategy**, formalizes which agents run on which Bedrock model tier and why, replacing the implicit "Bedrock, some model" assumption in prior versions with a deliberate, cost-modeled choice — including a redone cost projection for Nova 2 Lite at medium thinking versus the Claude-3.5-Sonnet baseline this research was originally priced against.

A compliance note surfaces in both additions and is worth stating once, up front: this plan explicitly **excludes** one tactic surfaced during research — using an agent to deanonymize a private individual's identity from their historical social-media post activity. That exclusion is treated as a permanent design constraint, not a placeholder, and is explained in full in §Phase 4, 4C.

---

## 1. The Design Brief This Plan Is Answering

AWS's own framing for the Professional Agents track is the north star for every decision in this document:

> *An agent that makes someone dramatically better at the work they already do. Built for professionals, makers, creators, small-business owners. Target the repetitive, judgment-heavy tasks that eat their day.*

Three words carry the most design weight, and every phase below is organized around them:

- **"Dramatically better," not "replaced."** Every feature has an explicit human checkpoint somewhere in its loop. The measure of success isn't "fully autonomous" — it's "the professional's judgment is spent only where judgment is actually needed."
- **"Repetitive."** Every agent exists because it removes a *specific, named, recurring* task from a specific persona's week. Where a task is repetitive but has no real judgment component, it is built as **non-agentic software**, not an agent (§1.2).
- **"Judgment-heavy."** The fork in the road for every feature: does this task require synthesizing ambiguous, unstructured, or conversational information to produce a next step? If yes, it's agentic. If it's a lookup, a calculation, or a fixed transformation, it's a function — not an agent call.

A fourth principle earns its place in this version specifically because of what the lead-generation research surfaced: **capability is not the only gate — legality and trust are gates too.** Two tactics researched this round (LinkedIn scraping, anonymous-user deanonymization) are technically buildable and are explicitly *not* built, because "an agent could do this" and "this agent should do this" are different questions, and this plan answers both for every feature, not just the first one.

---

## 2. How to Read This Plan

### 2.1 Phase structure

Six phases, each dependency-gated on the one before it. Every phase section states: **objective → entry criteria → what's built (agents, features, non-agentic infrastructure) at full end-to-end depth → value delivered per persona → exit criteria**. Nothing in a later phase is described as "TBD" — the full design for every feature in this plan exists now; phasing only controls *build order*.

### 2.2 What is deliberately never an agent, in any phase

Authentication/session management, CRUD screens for records, the pipeline/Kanban view, calendar rendering, notification delivery mechanics, static dashboard rendering (the *data* behind a dashboard can be agent-synthesized — see the Forecasting & Insight Agent in Phase 3 — but the chart-drawing itself is a React component), billing/invoicing for ImpulsoIQ's own subscription, user/role/permission management UI, raw email/SMS transport (SES/SNS doing the actual send once content is approved), data import/export mechanics, and the audit-log viewer itself (the *events* it displays are agent-authored; the log viewer is a query+render UI). These are Lambda/API Gateway/React, full stop — no LLM in the loop, in every phase.

### 2.3 The full agent roster (built out across Phases 1–4, reused without modification in Phase 5)

| Agent | One-line role | Introduced in |
|---|---|---|
| **Coordinator Agent** | Plans, decomposes, orchestrates every other agent; owns Graph/Swarm topology choice and gate enforcement | Phase 1 |
| **Clarification Agent** | Turns an ambiguous goal into a fully-specified one before execution starts | Phase 1 |
| **Research & Enrichment Agent** | Builds and refreshes the entity graph (accounts, contacts, signals) from internal and external sources — now including executive mapping and contact verification | Phase 2 |
| **Outreach & Drafting Agent** | Writes and sends on-brand, multi-channel written communication (email, SMS, LinkedIn-assisted) | Phase 2 |
| **Voice Agent (Outbound)** | Places real phone calls via CALL-E with a goal and a structured result schema | Phase 2 |
| **Nurture & Follow-up Agent** | Monitors engagement signals and re-engages on a schedule without being re-triggered | Phase 2 |
| **Forecasting & Insight Agent** | Synthesizes pipeline/activity data into forecasts, anomaly flags, and narrative insight | Phase 3 |
| **Data Hygiene Agent** | Finds duplicates, decayed records, and data-quality issues; proposes (never auto-applies) fixes | Phase 3 |
| **Ambient Interface Agent (Nova Sonic)** | Lets the *human user* operate ImpulsoIQ by voice, in-app | Phase 4 |
| **Deep Research Agent (Swarm)** | Open-ended, multi-strategy research for ambiguous asks, on named/known targets | Phase 4 |
| **Signal Listening Agent** *(new in v3)* | Continuous, unprompted monitoring of public web/social signals to originate brand-new candidate leads before any CRM record exists | Phase 4 |

Phase 5 (workspace expansion) and Phase 6 (enterprise hardening) introduce **zero new agents** — this is by design and is itself the core proof point of the platform thesis (PRD §2.2): the same eleven agents, reconfigured, carry the product from a sales tool into a workspace-wide platform.

---

## PHASE 1 — Foundation

### Objective
Stand up the substrate every later phase depends on: the non-agentic core product, the single-writer data path, and the two agents (Coordinator, Clarification) plus the hard-gate governance layer that every other agent will plug into.

### Entry criteria
None — this is the starting phase.

### 1A. Non-agentic core product

**Core CRM:** unified `Account`/`Contact`/`Deal` data model, pipeline/Kanban views, activity timeline (structurally identical for human- and agent-authored entries from day one), custom fields/objects, deduplication/merge UI shell.
**Identity & access:** Cognito auth, role-based access control, tenant provisioning flow (subdomain-based, per the architecture doc's §9 delegation model).
**Data layer:** Aurora DSQL with the full schema (`tenant`, `account`, `contact`, `deal`, `activity`, `agent_run`, `campaign`, `call_result`, `consent_record`), foreign keys enabled, explicit transaction-batching helpers built into the write-service layer from the start.
**Event backbone:** DynamoDB single-table event stream, streams enabled, feeding a basic activity-log viewer — the AppSync live-subscription consumer is added in Phase 2 once there's agent activity worth streaming live.

**Why this order:** building the CRM without any agent logic first means the single-writer CRM Write Service (below) can be built and tested against real, human-generated write traffic before any agent ever calls it.

### 1B. Single-writer CRM Write Service

**What it is:** the one internal service allowed to write to Aurora DSQL's system-of-record tables. Every specialist agent added in later phases calls this service instead of touching DSQL directly.
**End-to-end implementation:** exposed as a Gateway-invocable tool (`write_record`) even before any agent uses it, so the interface contract is fixed from Phase 1 onward.

### 1C. Coordinator Agent + Clarification Agent

**Task removed:** learning a tool's specific configuration UI for every new kind of task; re-explaining context the system should already know.
**End-to-end implementation:**
1. Goal enters via typed text or a trigger condition (voice input arrives in Phase 4).
2. Clarification Agent checks AgentCore Memory for settled preferences, asks only what's genuinely unresolved, using structured quick-select prompts where the answer space is small.
3. Coordinator builds an execution plan using the **Graph pattern exclusively** in this phase (Swarm doesn't exist until Phase 4) and runs a cost/scope estimate before anything executes.
4. Because there are no specialist agents yet, this phase is deliberately about proving the orchestration and governance skeleton works before hanging real capability off it.
**AgentCore services introduced:** Runtime, Memory, Gateway, Identity, Observability.
**Model:** Nova 2 Lite, medium thinking (see §5 for why this is the default across the roster).

### 1D. Governance: consent and policy hard-gating

**What it is:** the Cedar-based policy layer (AgentCore Policy) and the `ConsentRecord` enforcement mechanism, built and tested even though no outbound-communication agent exists yet to be gated.
**Why first:** every later phase's agents (Outreach, Voice, Nurture, and now Signal Listening) will call the same gate. Building the gate before the agents that need it means those agents are gated correctly from their first line of code.

### Value delivered in Phase 1
None directly visible to an end-user professional yet — this phase is intentionally infrastructure-only.

### Exit criteria
Core CRM usable by a human end-to-end with no agent involvement; single-writer service handling all writes; Coordinator/Clarification agents correctly building and gating plans; Cedar policies enforced and independently testable.

---

## PHASE 2 — Sales & RevOps Wedge

### Objective
Ship the product's actual wedge: the agent capability that makes a sales/RevOps professional's day dramatically better, end to end, including the trust surface (Control Panel) that makes delegating that work feel safe.

### Entry criteria
Phase 1 complete: write path, governance gate, and orchestration skeleton all working.

### 2A. Research & Enrichment Agent — now including Executive Mapping & Contact Verification

**Persona:** Malik (SDR), Owen (Marketing), Chen (RevOps).
**Task removed:** manually researching a company/contact across LinkedIn, the company site, news search, and a data provider before a single outreach touch is sent — and separately, manually guessing at (or paying a human to hunt down) a decision-maker's verified email address.

**The full four-step waterfall (step 4 is new in v3):**

1. **Internal history** (DSQL + Memory) — checked first; never re-derive what's already known and fresh.
2. **First-party enrichment API(s)** via Gateway tools — firmographic, technographic, intent/buying-signal data from licensed data providers.
3. **Browser tool**, for sources with no clean API and no scraping restriction — a company's own "About"/leadership page, a public press-release archive, a job-listings page (used here for growth-signal detection, not for scraping the job board's own gated search — see the licensing note below).
4. **New: Executive mapping & contact verification.**
   a. Given a company already resolved in steps 1–3, the agent needs named decision-makers at target titles (VP Sales, CMO, Director of Ops, etc.).
   b. **Executive names and titles are sourced from the licensed enrichment provider used in step 2 (or a dedicated org-chart data provider), not by directing the Browser tool at LinkedIn's own search or profile pages.** LinkedIn's terms of service prohibit automated access regardless of whether the underlying data is "public," and LinkedIn actively pursues enforcement against scrapers — this is a genuine legal and operational risk (IP blocks, CAPTCHA walls, potential legal exposure for the platform, not just the tenant), not a gray area worth building around. If a licensed provider doesn't return a name at the needed title, the agent stops at "no verified contact found" and surfaces that gap to the human rather than falling back to scraping.
   c. Once a name is resolved, the agent hypothesizes an email address against the company's domain's known pattern (`first.last@`, `f.last@`, `first@`, etc., inferred from any already-known verified address at that domain, or from the enrichment provider's own pattern data).
   d. The hypothesized address is passed to a **new Gateway tool: third-party email verification** (a Hunter.io/ZeroBounce-class API) — this is a legitimate, purpose-built SaaS category with no scraping or ToS concerns, and it directly protects the tenant's own sender reputation (PRD §14's deliverability risk) by keeping unverified guesses out of the send path.
   e. Only a verified-deliverable address is written with high confidence; an address that fails verification is either discarded or written with an explicit low-confidence flag that the Outreach Agent (2C) is configured to treat differently (e.g., route to a general company inbox pattern instead, or hold for human confirmation) — never presented to a rep as equivalent to a confirmed contact.
5. **Code Interpreter** computes a structured fit/confidence score per field from the gathered raw data — deterministic calculation, not an LLM guess, for consistency and auditability. Confidence scoring now explicitly includes contact-verification status as one of its inputs.
6. Result written via the CRM Write Service (Phase 1B), with source attribution and confidence per field stored in `enrichment_json`, and flows into the memory embed-on-write pipeline so future agents can semantically recall it.

**AgentCore services added this phase:** Browser, Code Interpreter (first use).
**Model:** Nova 2 Lite, medium thinking, for the synthesis/scoring steps; the executive-mapping lookup itself is largely deterministic tool orchestration and doesn't require heavy reasoning (see §5).
**Note:** the Deep Research Agent (Swarm, Phase 4B) handoff for genuinely open-ended asks and the Signal Listening Agent (Phase 4C) for lead *origination* are both referenced here but not built until Phase 4 — in Phase 2, an ambiguous research goal or an unprompted-discovery need simply isn't in scope yet; this agent only enriches records that already exist or have been explicitly targeted.

### 2B. Real-Time Inbound Lead Scoring & Routing

**Persona:** Owen, Malik.
**Task removed:** a lead sitting in a queue for hours while someone manually triages fit and ownership.
**Split:** Research & Enrichment Agent produces the fit/intent score (judgment-heavy); routing to a specific rep/queue is a **deterministic rules engine** (non-agentic).
**End-to-end implementation:** form submission/inbound webhook → Lambda → immediate enrichment trigger (target under 60 seconds) → deterministic routing service assigns owner based on score threshold, territory, and live rep-capacity data (a DynamoDB counter, kept out of DSQL per the contention guidance in the architecture doc).

### 2C. Outreach & Drafting Agent

**Persona:** Malik, Priya, Owen.
**Task removed:** writing dozens of individually-personalized emails/texts per week, and remembering which variant/angle was tried with whom.
**End-to-end implementation:**
1. Draws on enriched entity context (2A) — including the new contact-confidence signal — and the tenant's brand-voice profile.
2. Memory check ensures no repeated angle/contradiction with prior touches to this contact.
3. Draft passes schema validation (required opt-out footer for email — CAN-SPAM; required elements for SMS — CASL/TCPA) before reaching the pre-send checkpoint.
4. **New behavior tied to 2A's verification step:** if the target contact's email is low-confidence/unverified, the Outreach Agent's default checkpoint frequency automatically tightens for that send (e.g., forced human review regardless of the tenant's normal checkpoint setting) — an unverified contact is exactly the case where a human's judgment is most valuable before anything goes out.
5. On send: consent check (Phase 1D's hard gate) → SES/SNS dispatch → `Activity` record via the single-writer path.
6. A/B variant generation and interpretation ships in this phase for Growth tier+.

### 2D. Deliverability & Send-Pattern Protection

**Split:** Outreach Agent adjusts send pacing as part of planning (judgment); bounce/complaint-rate monitoring and hard-cap enforcement is a **non-agentic monitoring service**.
**End-to-end implementation:** CloudWatch alarms on SES reputation metrics → EventBridge → Lambda sets a tenant-level send-pause flag in the metering table (introduced in Phase 3, stubbed here) → Coordinator checks this flag before every send-step, same mechanism as the consent gate. The new contact-verification step (2A.4) is itself a deliverability-protection measure — fewer unverified sends means fewer bounces reaching this circuit breaker in the first place.

### 2E. Voice Agent (Outbound — CALL-E)

**Persona:** all wedge personas.
**Task removed:** the single highest-avoidance task on a professional's list — picking up the phone.
**Call types shipped this phase:** lead qualification, meeting confirmation, stalled-deal check-in.
**End-to-end implementation:**
1. Coordinator's graph node builds the call goal (natural-language task + structured `result_schema`) and checks the Phase 1D consent gate for channel = voice — hard stop, not soft check.
2. `VoiceProvider.placeCall()` invoked with an idempotency key and `metadata.workflow_run_id`.
3. CALL-E handles live conversation flow, interruption handling, voicemail detection, hold/transfer.
4. Completion: CALL-E webhook → API Gateway → Lambda validates idempotency → EventBridge `CallCompleted` → resumes the paused graph execution.
5. Schema-validation pass/fail tracked as an SLO; passing result writes via single-writer path; failing/low-confidence result routes to a human escalation queue.
6. Governance layer, always on: calling-window enforcement per recipient jurisdiction, DNC-registry screening, jurisdiction-appropriate recording-consent disclosure, three-tier kill switch.
**Integration approach:** wrapped behind the `VoiceProvider` interface from first line of code.

### 2F. Nurture & Follow-up Agent

**Persona:** Priya, Grace.
**Task removed:** remembering, across dozens of open threads, who hasn't replied and when to nudge again.
**End-to-end implementation:**
1. Subscribes to engagement events (email open/reply, SMS reply, meeting-calendar no-show webhook).
2. Per-contact cadence memory prevents over-contact.
3. On a qualifying silence threshold, decides next-best action: another written touch, or handoff to Coordinator for a Voice Agent call (2E) if the playbook allows and consent exists.
4. Every re-engagement decision logged with its reasoning, visible in the Control Panel.

### 2G. Agent Control Panel

Built as a parallel, equal-priority effort within this phase — trust infrastructure has to exist at the same time as the first agent that needs to be trusted.
**Non-agentic (a UI over agent-generated data):** live agent trace view (AppSync-subscribed, real-time), full action log, unified approval queue, pause/resume/kill controls at run/campaign/account level, cost/consumption dashboard.
**New in v3:** the approval queue now includes a distinct item type for "unverified contact — send held for review" (from 2C's new behavior), separate from a generic drafted-message review, so a rep can see at a glance *why* something is waiting on them.
**End-to-end implementation:** DynamoDB Streams (Phase 1A) → AppSync JS resolvers (field-shaping only) → GraphQL subscriptions → React Control Panel UI.

### Value delivered in Phase 2
A rep opens a new inbound lead and the full picture is already assembled, sourced, and — now — accompanied by a verified, deliverable contact address instead of a guess; speed-to-lead measured in under a minute; ready-to-send drafts instead of blank-page composition; hot leads called within minutes; nothing falls through the cracks on follow-up; and every action visible and controllable in the Control Panel from day one.

### Exit criteria
A full campaign — enrich (including contact verification) → draft → send/call → log outcome → nurture — runs end to end for a real sales workflow, fully gated and fully visible in the Control Panel.

---

## PHASE 3 — Insight & Quality

### Objective
Turn the activity Phase 2 generates into synthesized value (forecasting, hygiene) and turn the whole agent fleet into something whose quality is measurable and improvable, not just observable.

### Entry criteria
Phase 2 complete and generating real activity/engagement data across at least one full campaign cycle.

### 3A. Forecasting & Insight Agent

**Persona:** Chen (RevOps/Sales Manager).
**Task removed:** building a forecast spreadsheet by hand every week; noticing a stalled deal only after it's already dead.
**End-to-end implementation:**
1. Scheduled synthesis run reads DSQL reporting views plus the DynamoDB event stream.
2. **Code Interpreter** runs the statistical work (weighted pipeline forecast, cohort win-rate analysis, anomaly detection on deal velocity); the LLM layer turns output into narrative flags rather than doing the math itself.
3. Results written to a dedicated read-optimized reporting store.
4. Manager dashboard (non-agentic React) renders forecast, risk flags, and channel-efficacy breakdowns from this store — now including a contact-verification-rate metric per campaign (a direct quality signal on Phase 2A's new capability).

### 3B. Data Hygiene Agent

**Persona:** Chen, any admin.
**Task removed:** periodic, tedious manual dedup sweeps that never quite get prioritized.
**End-to-end implementation:** scheduled sweep → fuzzy-match tooling (Gateway tool, deterministic similarity scoring) → every proposed merge/refresh lands in the Control Panel approval queue → human confirms or dismisses; **never auto-applied**.

### 3C. Full Usage Metering & Cost Dashboard

**What it is:** the complete version of the metering pipeline stubbed in Phase 2D/2G — every billable unit (LLM tokens including reasoning/thinking tokens, enrichment lookups, contact-verification API calls, CALL-E call-minutes) tagged on its audit event at write time, aggregated per-tenant/per-billing-period, checked **synchronously before action**.
**New in v3:** this is the pipeline Phase 4's Signal Listening Agent (4C) is explicitly gated on before it's allowed to run unattended — a continuous background agent is only safe to expose once budget enforcement is proven against real, synchronous checks rather than after-the-fact reporting.
**End-to-end implementation:** DynamoDB Streams consumer → dedicated metering table (`tenant_id#period` partition) → checked by the Coordinator before any metered tool invocation → same data powers the Control Panel's cost dashboard directly.

### 3D. AgentCore Evaluations — Continuous Quality Pipeline

**What it is:** every agent built so far instrumented for OpenTelemetry/OpenInference tracing and evaluated continuously using an LLM-as-judge approach against defined per-agent criteria — Outreach: on-brand-voice adherence, factual grounding; Voice: schema-validation pass rate, appropriate escalation behavior; Clarification: minimum-necessary-questions efficiency; **Research & Enrichment (new criterion): contact-verification pass rate and false-positive rate on the executive-mapping step**, since a confidently-wrong contact is a worse outcome than a correctly-flagged unknown.

### Value delivered in Phase 3
A manager opens their dashboard to an already-synthesized read on what's at risk this week; data quality stays high continuously; tier limits are enforced predictably; and "we improved the Outreach Agent" or "we improved contact-verification accuracy" becomes a measurable, regression-testable engineering claim.

### Exit criteria
Forecasting and hygiene running on real historical data; metering enforced synchronously across every metered action, including the new contact-verification API calls; Evaluations producing per-agent quality scores on a recurring cadence.

---

## PHASE 4 — Interface, Research & Discovery Expansion

### Objective
Add the capabilities that expand *how* a professional interacts with the system (voice-native), *what kind* of ambiguous work it can take on for known targets (open-ended research), and — new in v3 — *where leads come from in the first place* (unprompted discovery). All three depend on the prior three phases being solid: voice input routes into the same Coordinator/Clarification pipeline Phase 1 built, and both Swarm research and Signal Listening need the cost-governance discipline Phase 3's metering pipeline established.

### Entry criteria
Phases 1–3 complete; Coordinator/Clarification pipeline stable; metering pipeline enforcing budgets synchronously.

### 4A. Ambient Interface Agent (Amazon Nova 2 Sonic)

Distinct from the Phase 2 Voice Agent — this lets the *professional talk to ImpulsoIQ itself*, not call third parties.

**Persona:** every persona, especially Dara (solo founder), Priya (quick status checks), Chen (spoken morning briefing).
**Task removed:** context-switching into a UI, navigating to the right screen, typing out a goal.
**What it does:** spoken goal intake (routed into the same Clarification → Coordinator pipeline as typed input), spoken status queries, an opt-in spoken morning briefing, and hands-free approval for low-risk, pre-scoped items only — anything configured as a mandatory approval gate still requires the visual Control Panel confirmation.
**End-to-end implementation:**
1. Browser microphone capture or mobile native audio capture, streamed over WebSocket to a thin Lambda/Fargate bridge.
2. Bridge opens Bedrock's `InvokeModelWithBidirectionalStream` session against Nova 2 Sonic.
3. Tool/function calling wired to the same Gateway tool surface every other agent uses — no parallel business logic.
4. Async tool calling lets the model acknowledge conversationally while multi-step planning happens in the background.
5. Turn-taking set to medium pause-sensitivity by default.
6. Every voice-issued action logged identically to a typed one, tagged `input_modality: voice`.

### 4B. Deep Research Agent (Swarm) — for known/named targets

**Persona:** Chen, Owen, or any user with a genuinely fuzzy research goal about a target they can already name.
**Task removed:** a multi-hour manual research sprint trying several angles to find "companies like our best customers" or map a competitive landscape.
**Distinction from 4C (important, new in v3):** the Deep Research Agent operates on a goal the user has explicitly stated ("find companies that look like X"), running multiple research *strategies* in parallel via Swarm orchestration. The Signal Listening Agent (4C) operates with no user-stated target at all — it's watching public signals continuously and deciding on its own what's worth surfacing. These are genuinely different capabilities that happen to share a cost-governance pattern; they are not the same feature at two maturity levels.
**End-to-end implementation:** Coordinator recognizes the goal shape doesn't fit the Graph pattern → cost/scope estimate presented for explicit approval → multiple research sub-agents run in parallel with distinct strategies, sharing a session-scoped memory scratch-space → Coordinator synthesizes a single ranked, sourced output.
**Cost governance:** Swarm runs are explicitly budget-capped and require the approval gate before starting — no exceptions.

### 4C. Signal Listening Agent — new in v3

**Persona:** Malik, Owen, and especially Dara (a solo founder or small team has no dedicated SDR doing continuous prospecting, so an always-on discovery layer is disproportionately valuable to exactly this persona).
**Task removed:** the manual, unstructured habit of a founder or marketer periodically checking Reddit, job boards, and industry press for signs that *someone out there* might need the product right now — work that's genuinely valuable but too diffuse and unstructured to reliably prioritize amid everything else on a busy week.

**What it explicitly does not do (design constraint, not a future roadmap gap):** it does not attempt to deanonymize an anonymous social-media poster by scraping their historical post history to infer their employer. That tactic surfaced in early research as a way to resolve "who is this person" from an anonymous complaint thread, and it is deliberately excluded: profiling a private individual who has not engaged with ImpulsoIQ or its tenant, without their knowledge, based on inference from unrelated public posts, is a materially different act from enriching a contact already in a sales funnel, and it carries real GDPR/CCPA "automated profiling" exposure along with an obvious trust cost if a prospect ever learns how they were identified. The Signal Listening Agent operates only on **identifiable company/brand mentions and public business signals** (a named company's job posting, a named company's press release, a forum post that already names a company or product) — never on inferring a private individual's identity from anonymous activity.

**Architecture — why this is a new agent, not an extension of 4B or 2A:**

| | Research & Enrichment (2A) | Deep Research / Swarm (4B) | Signal Listening (4C) |
|---|---|---|---|
| Trigger | A specific record enters scope | A user states a fuzzy goal about a named target | Nothing — runs continuously, unprompted |
| Orchestration | Graph, single agent | Swarm, multiple strategies | Graph, single agent, scheduled/continuous |
| Output | Enriches an existing/targeted record | A ranked, synthesized answer to a stated question | **Originates** brand-new candidate records that didn't exist in the CRM before |
| Cost shape | Bounded per record | Bounded per run, approval-gated | Unbounded unless explicitly capped — the primary governance concern |

**Two-stage model tiering (the mechanism that keeps this affordable — see §5 for full cost detail):**
1. **Cheap first-pass classification, high volume.** Raw text from monitored sources (a subset of Reddit's public API/PRAW-style stream on relevant subreddits, industry forum RSS feeds, job-board listing feeds, press-release wire feeds — all via licensed or explicitly-permitted access, not scraping gated logins) is passed through a low-cost, high-throughput model (Nova Micro tier) running a simple intent/relevance classifier: does this mention a named company, and does it suggest a business pain point this product addresses? Almost everything gets filtered out at this stage, cheaply.
2. **Expensive synthesis, low volume.** Only text that clears the first-pass filter is promoted to the full Research & Enrichment Agent (2A) pipeline — Nova 2 Lite at medium thinking — for company resolution, executive mapping, and contact verification, exactly as if a human had manually flagged that company as worth researching.

**Governance (mandatory, non-negotiable, mirrors Phase 4B's Swarm discipline):**
- Hard per-run token/turn caps (the source research's own recommendation of roughly 15 browser interactions per candidate is adopted as the default ceiling, tenant-configurable downward, not upward, without an explicit override).
- Pre-filtering of any fetched page content to lean, stripped markdown before it reaches the model context — never raw HTML/DOM dumped into a prompt.
- Rate-limit-aware, staggered request pacing to avoid tripping anti-scraping defenses on any source it touches, and immediate backoff/pause on any sign of being rate-limited rather than retrying aggressively.
- **Cannot run unattended until Phase 3C's synchronous metering/budget-check pipeline is live** — ships in this phase with a conservative, hard-coded per-tenant daily cap (environment-configured, not agent-discretionary) as an interim safeguard, the same stub-then-complete pattern already used for Phase 2D's deliverability circuit breaker.
- Every candidate lead it originates enters the Control Panel's approval queue as a distinctly-tagged item ("discovered, not requested") before it's treated as a normal CRM record — a human confirms it's worth pursuing before it enters the standard Phase 2 enrichment/outreach pipeline, which also means a bad classification never silently becomes an outbound touch to someone who never asked to be found.
- Legal/compliance review required before activation for any tenant, and per-source review as new monitored sources are added — this is treated the same way Phase 5B's AR-collections template requires counsel sign-off before activation: a template existing in the product doesn't mean it's on by default.

### Value delivered in Phase 4
Priya asks "how did the Meridian call go?" by voice instead of opening a laptop; a fuzzy research question about a named target gets a thorough, sourced answer in minutes at a clearly-communicated cost; and — new — a solo founder or small marketing team wakes up to a short, human-approved list of companies that showed a real signal overnight, without anyone having spent an hour manually checking Reddit and job boards for it.

### Exit criteria
Voice-issued goals produce identical, fully-audited behavior to typed goals; Swarm research runs are cost-bounded and approval-gated; the Signal Listening Agent is running within its hard-coded interim caps, every originated candidate is passing through human approval before entering the standard pipeline, and legal review has signed off for every active tenant/source combination.

---

## PHASE 5 — Workspace Expansion

### Objective
Prove the core platform thesis: the same agent roster, reconfigured with new goal templates and guardrails, serves departments beyond sales — without building a single new agent.

### Entry criteria
All eleven agents (Phase 1–4) live in production with real usage history; Evaluations (3D) showing stable quality scores; metering/governance (1D, 3C) proven reliable under real load.

### 5A. Recruiting Coordination (Persona: Ines)
**Reused agents:** Research & Enrichment (candidate/company research — the same verification discipline from 2A applies to candidate contact info), Outreach & Drafting, Voice Agent, Nurture Agent.
**Template differences:** brand-voice shifts to candidate-experience tone; consent/compliance rules shift to employment-communication regulations; interview scheduling changes always require human confirmation.
**Value delivered:** a recruiter's day stops being consumed by scheduling logistics, freeing time for candidate evaluation.

### 5B. Accounts-Receivable Follow-Up (Persona: Renata)
**Reused agents:** Outreach & Drafting, Voice Agent, Nurture Agent.
**Template differences — the strictest guardrails in the whole system:** tone fixed to "polite, non-aggressive, informational" with no agent discretion to escalate tone; every call beyond a configured lateness/amount threshold hard-escalates to a human; full FDCPA-adjacent compliance review required before activation.
**Value delivered:** overdue invoices chased consistently and on-brand without ad hoc collections risk.

### 5C. Vendor/Ops Coordination (Persona: Tomás)
**Reused agents:** Outreach & Drafting, Voice Agent.
**Template differences:** structured status confirmation (`on_schedule`, `delayed`, `new_eta`) rather than persuasion/qualification.
**Value delivered:** an ops manager stops manually calling suppliers every week for status updates.

### 5D. Appointment Scheduling & Reminders (Persona: Sam)
**Reused agents:** Outreach & Drafting, Voice Agent.
**Template differences:** highest call volume, lowest complexity — the best candidate for the most fully-automated, least approval-gated configuration in the system.
**Value delivered:** a small clinic or salon's front-desk time freed from the most repetitive task on their list.

### 5E. Customer Success Renewal & Save Motion (Persona: Grace)
**Reused agents:** Research & Enrichment (usage-signal enrichment), Outreach & Drafting, Voice Agent, Nurture Agent, Forecasting & Insight Agent (renewal-risk scoring).
**Template differences:** trigger source shifts from "new inbound lead" to "usage-decline signal" or "renewal date approaching" — the cleanest proof point of the whole thesis, requiring zero new agent capability.
**Value delivered:** churn risk caught while there's still time to act, with a proactive save call happening automatically.

### Value delivered in Phase 5
Direct validation of PRD §5.2's workspace cross-sell thesis — a second department activated at close to zero incremental engineering cost.

### Exit criteria
At least one tenant running two or more workspace templates concurrently; each template's guardrails independently reviewed (legal review specifically required before 5B activates for any tenant/region).

---

## PHASE 6 — Enterprise Hardening

### Objective
Everything a larger customer's procurement, security, and compliance process will require before they'll sign — gated on actual enterprise-tier sales demand rather than built speculatively ahead of it.

### Entry criteria
Workspace expansion (Phase 5) proven with at least one real multi-department tenant; enterprise-tier sales pipeline creating concrete demand for this phase's specific controls.

### 6A. Full Data & Search Layer Completion
- **OpenSearch Service** for hybrid lexical+semantic search once workspace-expansion usage demonstrates real need.
- **Multi-Region data residency** via Aurora DSQL's active-active multi-Region capability.

### 6B. AgentCore Registry
A discoverable catalog of every agent/tool/template — including, by this point, the Signal Listening Agent's per-source configuration — for RevOps/IT admins at larger customers.

### 6C. A2A Protocol — Cross-Department Agent Handoff
Once a tenant has two or more workspace domains active, the open A2A standard becomes the mechanism for cross-department context handoff.

### 6D. Enterprise Identity & Compliance
- SSO/SAML via Cognito.
- SOC 2 Type II — full control implementation, reusing the kill-switch mechanisms already built in Phase 2E for product reasons.
- Full multi-jurisdiction compliance matrix, per-tenant-configurable — by this phase, this matrix explicitly includes the Signal Listening Agent's source-by-source legal review status per jurisdiction, not just the outbound-communication rules the matrix originally covered.

### 6E. Explicitly deferred: AgentCore Payments (x402)
Not adopted in any phase of this plan. Every metered cost is checked against a pre-approved allotment (Phase 3C), not agent-initiated purchasing.

### Value delivered in Phase 6
Nothing new for an existing SMB/mid-market tenant — this phase exists entirely to make the product signable by enterprise buyers.

### Exit criteria
SOC 2 Type II report issued; SSO/SAML live for at least one enterprise pilot tenant; A2A handoff demonstrated between two workspace domains in production.

---

## 3. Master Feature-to-Agent-to-Phase Matrix

| # | Feature | Delivered by | Phase |
|---|---|---|---|
| 1 | Core CRM, single-writer path, orchestration skeleton, consent/policy gating | Non-agentic + Coordinator/Clarification | 1 |
| 2 | Multi-source lead/account enrichment | Research & Enrichment Agent | 2 |
| 3 | **Executive mapping & contact verification** *(new)* | Research & Enrichment Agent, step 4 | 2 |
| 4 | Real-time inbound lead scoring & routing | Research & Enrichment Agent + deterministic routing | 2 |
| 5 | AI-drafted multi-channel sequences | Outreach & Drafting Agent | 2 |
| 6 | Deliverability & send-pattern protection | Outreach Agent + non-agentic monitoring | 2 |
| 7 | Outbound qualification/confirmation/save calls | Voice Agent (CALL-E) | 2 |
| 8 | Reply/no-show/silence monitoring & re-engagement | Nurture & Follow-up Agent | 2 |
| 9 | Agent Control Panel | Non-agentic UI over the audit-event stream | 2 |
| 10 | Pipeline forecasting & risk flagging | Forecasting & Insight Agent | 3 |
| 11 | Duplicate detection & data hygiene | Data Hygiene Agent | 3 |
| 12 | Full usage metering & cost dashboard | Non-agentic pipeline, agent-invoked gate | 3 |
| 13 | Continuous agent-quality evaluation | AgentCore Evaluations, all agents | 3 |
| 14 | In-app ambient voice command & briefing | Ambient Interface Agent (Nova Sonic) | 4 |
| 15 | Open-ended research on named targets | Deep Research Agent (Swarm) | 4 |
| 16 | **Signal-sourced lead discovery** *(new)* | Signal Listening Agent | 4 |
| 17 | Recruiting-coordination templates | Research + Outreach + Voice + Nurture, recruiting-scoped | 5 |
| 18 | Accounts-receivable follow-up templates | Outreach + Voice + Nurture, AR-scoped | 5 |
| 19 | Vendor/ops coordination templates | Outreach + Voice, ops-scoped | 5 |
| 20 | Appointment scheduling & reminder templates | Outreach + Voice, admin-scoped | 5 |
| 21 | Customer success renewal/save motion | Research + Outreach + Voice + Nurture + Forecasting, CS-scoped | 5 |
| 22 | Hybrid search, multi-region residency | Non-agentic infrastructure | 6 |
| 23 | Registry, A2A cross-department handoff | Non-agentic infrastructure, agent-invoked | 6 |
| 24 | SSO/SAML, SOC 2, full compliance matrix | Non-agentic infrastructure | 6 |

---

## 4. Full Agent/AgentCore-Service Cross-Reference by Phase

| Agent | Phase | Runtime | Memory | Gateway | Identity | Policy | Observability | Evaluations | Browser | Code Interpreter | Registry |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Coordinator | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (from P3) | | | ✓ (from P6) |
| Clarification | 1 | ✓ | ✓ | | ✓ | | ✓ | ✓ (from P3) | | | |
| Research & Enrichment | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (from P3) | ✓ | ✓ | |
| Outreach & Drafting | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (from P3) | | | |
| Voice Agent | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (from P3) | | | |
| Nurture & Follow-up | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | |
| Forecasting & Insight | 3 | ✓ | | ✓ | ✓ | | ✓ | | | ✓ | |
| Data Hygiene | 3 | ✓ | | ✓ | ✓ | ✓ | ✓ | | | | |
| Ambient Interface (Nova Sonic) | 4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| Deep Research (Swarm) | 4 | ✓ | ✓ (session-scoped) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| **Signal Listening** *(new)* | 4 | ✓ | ✓ (candidate scratch-space) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ (from P6) |

---

## 5. Model Tiering Strategy (Cross-Cutting, New Section in v3)

Prior versions of this plan assumed "a Bedrock model" without specifying which, model-by-agent. This version formalizes the choice, since it materially affects both quality and cost, and since the research that prompted this update priced everything against a different model than the one actually in use.

### 5.1 The default: Nova 2 Lite, medium extended thinking

Amazon Nova 2 Lite is the default model for every agent in the roster except where a specific reason calls for a different tier (below). Extended thinking is enabled at **medium** reasoning effort — a deliberate middle point between the fast/cheap default (thinking off) and the highest-effort setting, chosen because most of this system's agentic work (planning a campaign, drafting on-brand copy, deciding whether a call outcome needs escalation) benefits from genuine step-by-step reasoning but doesn't need the highest, slowest, most expensive effort tier to get there reliably.

### 5.2 Where a different tier is used, and why

| Agent/step | Model tier | Reason |
|---|---|---|
| Signal Listening Agent — first-pass classification (4C, stage 1) | **Nova Micro** | High-volume, low-complexity binary/ternary classification (does this mention a company + a pain point?) — using anything more expensive here would dominate the cost of a feature that's supposed to be cheap specifically because most inputs get filtered out immediately |
| Signal Listening Agent — promoted-candidate synthesis (4C, stage 2) | Nova 2 Lite, medium thinking | Identical to Research & Enrichment (2A) — a promoted candidate gets exactly the same treatment as a manually-targeted record |
| Ambient Interface Agent (4A) | **Nova 2 Sonic** | Speech-to-speech is a distinct model family, not a text model with voice bolted on — required for the live, bidirectional conversational capability itself |
| Deep Research Agent, Swarm sub-agents (4B) | Nova 2 Lite, medium thinking, per sub-agent | Consistent with the rest of the roster; the cost risk in Swarm comes from running multiple parallel sub-agents, not from any individual sub-agent needing a heavier model |
| Forecasting & Insight Agent's actual numeric work (3A) | **Not a model at all — Code Interpreter** | Statistical forecasting and cohort analysis are deterministic computations; the LLM's role is narrating the output, not producing it |

### 5.3 Redone cost projection: Nova 2 Lite (medium thinking) vs. the Claude-3.5-Sonnet baseline the original research used

The lead-generation research that prompted this update priced a one-hour, 30-turn deep-research loop against Claude 3.5 Sonnet. Since that's not the model in use, the projection is redone here for the actual configuration. **Caveat, stated plainly:** AWS has not published an exact reasoning-token multiplier per thinking-effort level, so the "medium thinking" overhead below is a directional estimate (a conservative ~4x base-output-token assumption), not a quoted price — it should be validated against real, logged token counts once Phase 3D's Evaluations/Observability pipeline is live, and this table should be revisited at that point rather than treated as final.

| Cost element | Claude 3.5 Sonnet (original research baseline) | Nova 2 Lite, medium thinking (this plan's actual model) |
|---|---|---|
| Input (1.35M tokens) | $4.05 | $0.41 |
| Base output (24K tokens) | $0.36 | $0.06 |
| Reasoning/thinking tokens (medium effort, ~4x base output, estimated) | n/a | ~$0.24 |
| **LLM subtotal** | **$4.41** | **~$0.71** |
| Infrastructure (AgentCore Runtime + Browser Tool, unchanged by model choice) | $0.11 | $0.11 |
| **Total per research-hour** | **$4.52** | **~$0.82** |
| Projected at 1,000 comparable sessions/month | ~$4,500 | **~$820** |

This roughly 82% reduction is the specific reason the Signal Listening Agent (4C) is economically viable as a *continuous* background capability rather than something that would have to be sharply rationed even after the two-stage tiering (§5.2) already does most of the cost-control work — the two mechanisms compound rather than substitute for each other.

### 5.4 A further, non-model cost lever

Nova 2 Lite ships with native web grounding and a built-in code interpreter. For simpler lookups within the Research & Enrichment Agent's waterfall (2A) — a general company search, a press-release summary — native web grounding can substitute for spinning up a full AgentCore Browser Tool session entirely. Browser Tool is reserved specifically for pages that require real interaction (pagination, forms, session state, JS-rendered content) that grounding alone can't reach. This distinction should be encoded directly into the Research & Enrichment Agent's tool-selection logic during Phase 2 build-out, not left to per-call judgment.

---

## 6. Cross-Phase Dependency Summary

- **Phase 2 depends on Phase 1's** single-writer service and consent/policy gate.
- **Phase 3 depends on Phase 2's** real activity data and Control Panel.
- **Phase 4 depends on Phase 3's** metering pipeline — this now gates *three* capabilities, not two: the Ambient Interface Agent's usage, Swarm's unpredictable cost, and the Signal Listening Agent's continuous, unprompted spend, which is arguably the least bounded of the three and therefore the one most in need of Phase 3C being genuinely solid before activation.
- **Phase 5 depends on Phases 1–4's** full agent roster having real production track records before being repointed at higher-liability domains, AR collections specifically — and, new in v3, before the Signal Listening Agent's discovery patterns are reused as a template for any workspace-expansion domain (e.g., a future "signal-sourced candidate discovery" for recruiting), which this plan does not scope now but should not be ruled out structurally.
- **Phase 6 depends on Phase 5's** multi-department proof point and is otherwise gated on sales demand, not technical dependency. Phase 6's compliance matrix (6D) now also has to account for the Signal Listening Agent's per-source, per-jurisdiction legal status, which grows the matrix's scope somewhat beyond its original outbound-communication-only focus.

This dependency chain is also the argument for why nothing in this plan should be built out of order even under schedule pressure: each phase is what makes the next one *safe*, not just what happens to come next chronologically. The v3 additions make this point sharper, not weaker — the single feature with the most unbounded cost and compliance exposure in the whole plan (Signal Listening) is also the one sequenced latest and gated behind the most prior infrastructure, which is exactly the right relationship between a feature's risk and its place in the build order.
