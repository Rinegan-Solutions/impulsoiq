# ImpulsoIQ — Implementation Plan (Phased): Agents, Features, and End-to-End Delivery

**Full enterprise scope, sequenced into build phases — mapped feature-by-feature to the agent(s) that deliver it, written against AWS's own "Professional Agents" definition**

| | |
|---|---|
| **Document owner** | Blessyn |
| **Companion docs** | PRD v4 (`impulsoiq-prd-v4.md`), Technical Architecture v1 (`impulsoiq-technical-architecture-v1.md`) |
| **Status** | v4 — adds Phases 7–9: the Agentic Customer Service Contact Center |
| **Sequencing basis** | Dependency order, not calendar dates |
| **Default agentic model** | Amazon Nova 2 Lite, extended thinking at medium reasoning effort, unless a specific agent calls for a different tier (§5) |

---

## 0. Changelog — v3 → v4

Adds a second full product surface, phased as its own foundation → wedge → insight arc (Phases 7–9), mirroring the shape Phases 1–3 used for the sales side. This is deliberately not squeezed into a single workspace-expansion bullet (as originally sketched under Phase 5) — a native, fully-matured contact center is genuinely its own build track, with its own data model, its own human-facing UI, and its own AWS infrastructure decision (Amazon Connect, addressed in §Phase 7). Everything from v1–v3 is preserved unchanged; Phases 7–9 are additive and depend on Phases 1–6 already being in place.

---

## 1. The Design Brief This Plan Is Answering

*(unchanged from v3 — restated for completeness)*

AWS's own framing for the Professional Agents track:

> *An agent that makes someone dramatically better at the work they already do. Built for professionals, makers, creators, small-business owners. Target the repetitive, judgment-heavy tasks that eat their day.*

Phases 7–9 apply this to the single most volume-heavy, most emotionally taxing judgment-heavy task in the whole persona set: a support inbox that never stops arriving. The narrative for why this belongs on this platform, not as a bolted-on third-party tool: **the relationship a business has with a customer is one continuous thing.** Everything upstream of a support contact (winning the account, keeping it healthy) already has an agent watching it in this plan. The moment a customer speaks up is the one point in the relationship where, currently, the agent fleet goes silent and a human starts from zero. Phases 7–9 close that gap using the same agents, the same governance, and the same Control Panel already built — proving the "agentic workspace" thesis on its hardest test: not just reusing agents across departments, but across the inbound and outbound halves of the same relationship.

---

## 2. How to Read This Plan

*(structure unchanged from v3; see prior version for full detail — summarized here)*

Nine phases now, each dependency-gated on the one before it. §1.2 (what's never an agent) and the full agent roster (§1.3) both carry forward unchanged, extended below with the three agents Phases 7–9 introduce.

### 2.1 Full agent roster, updated

| Agent | One-line role | Introduced in |
|---|---|---|
| Coordinator Agent | Plans, decomposes, orchestrates every other agent | Phase 1 |
| Clarification Agent | Turns an ambiguous goal into a fully-specified one | Phase 1 |
| Research & Enrichment Agent | Builds/refreshes the entity graph, including contact verification | Phase 2 |
| Outreach & Drafting Agent | Writes/sends on-brand outbound communication | Phase 2 |
| Voice Agent (Outbound) | Places outbound calls via CALL-E | Phase 2 |
| Nurture & Follow-up Agent | Monitors engagement, re-engages on schedule | Phase 2 |
| Forecasting & Insight Agent | Synthesizes pipeline/activity into forecasts | Phase 3 |
| Data Hygiene Agent | Finds duplicates/decay, proposes fixes | Phase 3 |
| Ambient Interface Agent (Nova Sonic) | Voice interface for the user to operate ImpulsoIQ | Phase 4 |
| Deep Research Agent (Swarm) | Open-ended research on named targets | Phase 4 |
| Signal Listening Agent | Continuous, unprompted lead-signal discovery | Phase 4 |
| **Triage & Escalation Agent** *(new)* | Classifies every inbound support contact on arrival; the inbound counterpart to Research & Enrichment | **Phase 7** |
| **Resolution Agent** *(new)* | Grounded, KB-cited auto-resolution and draft-reply generation for support conversations | **Phase 8** |
| **Support Insight Agent** *(new)* | Synthesizes support data into CSAT/SLA/backlog insight and KB-gap detection; the support-side counterpart to Forecasting & Insight | **Phase 9** |

Fourteen agents total. Notably, Phases 7–9 reuse the Outreach & Drafting Agent (support macros/canned-response suggestion), the Voice Agent (outbound callbacks), the Nurture Agent (post-resolution follow-up), and the Control Panel — only three genuinely new agents are needed for an entire second product surface, which is itself the clearest evidence yet that the platform thesis holds at scale.

---

*(Phases 1–6 unchanged from v3 — omitted here for length; see `impulsoiq-implementation-plan-v3-phased.md` for full text. New content begins at Phase 7.)*

---

## PHASE 7 — Contact Center Foundation

### Objective
Stand up the substrate the agentic support experience depends on: a unified, omnichannel conversation model, the inbound telephony/digital-channel infrastructure decision, the Triage & Escalation Agent, and the rep-facing queue UI — before any resolution logic exists. This mirrors Phase 1's own sequencing rationale exactly: get the foundation and the governance-relevant classification layer right before hanging capability off it.

### Entry criteria
Phases 1–6 complete. Specifically depends on: the single-writer CRM Write Service (1B) being extended to a new set of record types (below); the Control Panel (2G) as the pattern the new rep queue UI will follow; and the eleven-agent roster having a proven production track record (this is, after all, the same "don't repoint a mature agent fleet at a new, higher-stakes domain until it's earned it" logic already applied to Phase 5B's AR template).

### 7A. Why Amazon Connect, not CALL-E, for the inbound side — and why this doesn't create two parallel systems

CALL-E remains the platform for every **outbound** call across this entire plan (Phase 2E and all of Phase 5's reused templates) — nothing about that changes. Inbound contact-center telephony is a different problem: it needs queueing, skill-based routing, an agent workspace with presence/status, and native omnichannel digital-channel handling (chat, SMS) unified with voice — none of which CALL-E is built for, and none of which should be hand-rolled when a purpose-built AWS-native service already does it well.

**Decision: Amazon Connect is the inbound telephony and omnichannel routing backbone.** This is grounded in real market evidence, not a default assumption:

- Connect is explicitly AWS's own recommendation for "AWS-native enterprises building from scratch" in independent 2026 contact-center platform comparisons, and it's usage-based (pay-per-use, no seat licensing) rather than requiring per-agent contracts — consistent with this plan's cost discipline elsewhere.
- Connect's 2026 AI-first feature set — **Contact Lens** (built-in call/chat transcription, sentiment analysis, trend detection) and the newer **Connect Customer AI agents** capability — is directly relevant: Connect Customer AI agents natively support **MCP (Model Context Protocol)**, meaning it's the same tool-integration standard the rest of this plan's Gateway architecture already speaks. Concretely, this means ImpulsoIQ's own Bedrock/AgentCore agents (Triage & Escalation, Resolution) are invoked *from* Connect Contact Flows via Lambda, using the same Gateway tool surface every other agent in this system already calls — Connect is infrastructure underneath, not a second, disconnected agent brain running in parallel.
- **A deliberate choice against relying on Amazon Q in Connect or Connect's own native AI agents as the reasoning layer.** Both are genuinely capable, but adopting them as the *decision-making* layer would mean support conversations are reasoned about by a system the Control Panel (§2G, carried forward) can't natively trace, evaluate (Phase 3D's Evaluations pipeline doesn't cover Q in Connect's internal reasoning), or govern through the same Cedar policy layer as every other agent. Connect provides the telephony/routing/workspace infrastructure and its Contact Lens analytics as a *data source*; ImpulsoIQ's own Triage & Escalation and Resolution agents remain the reasoning layer, invoked from within Connect's contact flows, so every support decision is logged, evaluated, and governed identically to a sales decision. This is the single most important architectural decision in this phase, because getting it backwards would mean building a second, un-auditable agent system alongside the first.

**What Connect is used for, concretely:** phone number provisioning and inbound call handling, IVR-equivalent contact flows (with a Lambda step that invokes the Triage & Escalation Agent instead of a static menu tree), queueing and skill/capacity-based routing execution, the native chat channel transport, and Contact Lens's built-in transcription and sentiment scoring (consumed as a signal by ImpulsoIQ's own agents rather than re-built from scratch).

### 7B. Data model expansion

New entities, added to the existing schema via the same single-writer CRM Write Service (1B) — genuinely new record types, not a reuse of sales-side entities, though every one of them links back to the existing `Account`/`Contact` graph:

```
conversation      (conversation_id PK, tenant_id FK, contact_id FK → contact,
                    channel_history JSONB [array of channels this thread has touched],
                    status ENUM(open|pending|resolved|closed), created_at, first_response_at,
                    resolved_at, csat_score, csat_captured_at)
message           (message_id PK, conversation_id FK → conversation, channel ENUM(email|chat|sms|voice|social),
                    sender_type ENUM(customer|human_rep|agent), body, transcript_s3_key (voice only),
                    sentiment_score, created_at)
ticket            (ticket_id PK, conversation_id FK → conversation UNIQUE, queue_id FK → queue,
                    tier ENUM(0|1|2|3), assigned_rep_id, sla_target_at, sla_breached_at, priority, tags)
queue             (queue_id PK, tenant_id FK, name, required_skills JSONB, sla_policy_id FK)
sla_policy        (sla_policy_id PK, tenant_id FK, first_response_target_minutes, resolution_target_minutes,
                    breach_escalation_rule JSONB)
agent_status      (rep_id PK+tenant_id, status ENUM(available|busy|offline), concurrent_ticket_count, updated_at)
macro             (macro_id PK, tenant_id FK, title, body_template, usage_count)
knowledge_article  (article_id PK, tenant_id FK, title, body, status ENUM(draft|published|deprecated),
                    version, embedding_ref [S3 Vectors pointer], last_reviewed_at)
```

**Design note carried over from the rest of the plan:** `conversation` — not `ticket` — is the anchor entity, deliberately. A customer who emails Monday and calls Wednesday about the same issue is one `conversation` with a `channel_history` spanning both, not two disconnected tickets. This is the concrete schema-level expression of the "one customer, one history" narrative established earlier.

### 7C. Triage & Escalation Agent

**Persona:** Grace (CS/support), and — via context surfacing, not action — any rep grabbing a ticket.
**Task removed:** a support inbox arriving as an undifferentiated pile that someone has to manually read and prioritize before any actual resolution work starts.
**End-to-end implementation:**
1. Fires on every new `message` creating or appending to a `conversation` — from Connect (voice/chat via Contact Flow → Lambda), or directly via the Gateway for email/SMS/social-mention intake.
2. Classifies across two axes, exactly as scoped in the earlier brainstorm: **complexity/confidence** (can this be resolved from known information, or does it need judgment?) and **risk/sentiment** (Contact Lens's sentiment score, plus the agent's own reading of refund/cancellation/legal-mention language), producing one of four tiers:

| Tier | Example | Default handling |
|---|---|---|
| 0 — Auto-resolve | "Where's my invoice?" | Resolution Agent (Phase 8) responds directly, logged, no human touch unless the customer pushes back |
| 1 — Draft for review | Feature question needing nuance | Resolution Agent drafts, human reviews/sends |
| 2 — Human required, agent-assisted | Billing dispute, negative sentiment | Routed straight to a rep with full context pre-loaded; no agent-drafted reply |
| 3 — Hard escalate | Refund/cancellation, legal mention, repeat unresolved contact | Never touched by an agent's draft — routed to a manager/senior rep, tagged urgent, structurally guaranteed (routing-layer rule, not agent judgment) |

3. Pulls the same account context Research & Enrichment (2A) and Forecasting & Insight (3A) already maintain — deal history, renewal-risk score, prior ticket count and resolution pattern — as inputs to the classification, not just the message text in isolation. A customer with a rising renewal-risk score gets a lower auto-resolve threshold by design, since the cost of mishandling this contact is higher than average.
4. Skill-based and capacity-based routing (a **deterministic** step, not agentic, consistent with the "routing is a rules engine" pattern already established in 2B) assigns the ticket to a queue and, where a human touch is needed, a specific rep — respecting `required_skills` and each rep's live `concurrent_ticket_count`.
5. SLA target is stamped onto the `ticket` at creation from the queue's `sla_policy`; a scheduled check (EventBridge, not agentic) flags approaching or breached SLAs and auto-escalates tier where a breach is imminent, regardless of the original classification.
6. Every classification decision, and its reasoning, is logged in the Control Panel exactly as any other agent's action would be — visible, auditable, and reviewable via Phase 3D's Evaluations pipeline (a new evaluation criterion for this agent: tier-classification accuracy against human-corrected tiers over time).

**AgentCore services:** Runtime, Memory (reads long-term account context), Gateway, Identity, Policy (tier-3 hard-escalation is enforced as a routing rule, not left to agent discretion — mirrors how AR's tone-ladder in Phase 5B is enforced), Observability, Evaluations.
**Model:** Nova 2 Lite, medium thinking — this is a genuinely judgment-heavy classification (sentiment + risk + context synthesis), not the high-volume/low-complexity shape that would call for a cheaper tier.

### 7D. Rep-Facing Queue & Conversation UI

**Non-agentic** — the support-side counterpart to the Control Panel, built for a different daily workflow (queue-clearing, not campaign-reviewing).
**Features:** ticket list by queue with SLA countdown, unified conversation view (full cross-channel thread in one place), presence/status toggle, internal notes visible only to reps, manual grab/reassign/escalate/merge/split actions available on any ticket regardless of its assigned tier — a rep can always pull a ticket out of its default routing.
**End-to-end implementation:** same real-time pattern as the Control Panel — DynamoDB Streams → AppSync JS resolvers → GraphQL subscriptions → React UI — so a new message appearing on an open conversation updates a rep's screen live, without polling.

### 7E. Knowledge Base — foundation only (authoring; grounding capability ships in Phase 8)

**Non-agentic authoring/versioning UI** for `knowledge_article` records — draft/publish/deprecate workflow, version history. The embedding pipeline (S3 Vectors, reusing the semantic-memory infrastructure from Technical Architecture §5) that makes articles retrievable by the Resolution Agent is built in this phase so Phase 8 can consume it immediately, but no agent reads from it yet — Phase 7 is foundation, not resolution.

### Value delivered in Phase 7
Nothing customer-visible yet — same intentional shape as Phase 1. What ships is a support inbox that's already correctly triaged, routed, and SLA-tracked by the time Phase 8's resolution capability arrives, and a rep queue UI that already feels coherent rather than a placeholder.

### Exit criteria
Every inbound contact across email/chat/SMS/voice/social lands in a unified `conversation`, is correctly tiered and routed, SLA targets are tracked and breach-escalated, and reps can work the queue UI end-to-end (manually, without agent-drafted assistance yet).

---

## PHASE 8 — Agentic Resolution & Routing

### Objective
Ship the actual value proposition: fast, grounded, appropriately-scoped resolution — instant where it's safe, drafted where it needs a human's judgment, and never agent-touched where the risk is real. This is the wedge phase, mirroring Phase 2's role for the sales side.

### Entry criteria
Phase 7 complete: triage/tiering proven accurate on real (or shadow-mode) traffic before any tier is allowed to auto-act.

### 8A. Resolution Agent

**Persona:** Grace and every support rep; indirectly, every customer.
**Task removed:** typing the same category of answer for the tenth time this week; starting a reply from a blank page even when the account's full context is already known.
**Why a new agent, not a reuse of Outreach & Drafting:** Outreach & Drafting (2C) drafts *outbound-initiated* communication from enrichment context, optimized for persuasion/qualification framing. The Resolution Agent answers an *inbound* question, must ground its answer in cited knowledge-base content (a factual-accuracy requirement outbound drafting doesn't have in the same way — a wrong sales angle is a missed opportunity, a wrong support answer is a broken promise), and for Tier 0 needs a defined action surface (what it's actually allowed to *do*, not just say — see 8C). That's different enough to warrant its own agent, sharing the same model tier and much of the same Gateway tooling.
**End-to-end implementation:**
1. Invoked by the Coordinator once Triage & Escalation (7C) has tiered a conversation as 0 or 1.
2. **Grounded retrieval, always first:** queries the same single `query_memory` Gateway tool the rest of the system uses (Technical Architecture §5.1), now also indexed against `knowledge_article` embeddings (7E) — retrieves the most relevant published articles before generating anything.
3. Drafts a response that **cites which knowledge-base article(s) it's grounded in** — every Resolution Agent output carries source attribution, both so a reviewing human (Tier 1) can verify it in seconds rather than re-deriving the answer, and so a customer-facing answer is traceable if it's ever disputed.
4. **Confidence gate:** if retrieval doesn't surface a sufficiently relevant, sufficiently current (`last_reviewed_at` within policy) article, the Resolution Agent does not guess — it downgrades its own output from "auto-resolve" to "insufficient grounding, route to human," overriding Triage's original Tier-0 classification. This is the single most important reliability guardrail in this phase: an ungrounded confident answer is worse than an honest "I don't know," and the architecture makes the honest path the default failure mode, not an edge case someone has to remember to handle.
5. **Tier 0:** response sent directly, logged in the Control Panel, `conversation.status` updated; customer can always reply back into the thread, which re-triggers Triage on the new message (nothing is a dead end).
6. **Tier 1:** response staged in the rep queue UI (7D) as a draft awaiting review — rep edits or sends as-is; every edit is itself a signal fed to Evaluations (Phase 3D) for measuring draft-acceptance-without-edit rate, the support-side equivalent of the sales Outreach Agent's existing quality metric.
7. **Tiers 2 and 3 never reach this agent** — Triage routes those straight to a human with context surfaced (not drafted), per 7C's hard routing rule.

### 8B. Macro/Canned-Response Suggestion

**Split, consistent with the plan's "reserve judgment for what needs it" principle:** a human-authored macro library (non-agentic content) with **agent-suggested matching** — when a rep opens a ticket, the Resolution Agent (or a lightweight classification pass) suggests the most relevant existing macro based on similarity to past resolved tickets, saving the rep a search rather than replacing their judgment about which one actually fits.

### 8C. Tier-0 Action Surface — explicitly scoped, not open-ended

A genuinely important design decision: what is a fully-automated Tier-0 response actually *allowed to do*, beyond just replying with text? This needs to be a small, explicit, tenant-configurable allowlist, not "whatever the agent decides":

- Allowed by default: sending informational replies, attaching a knowledge article, updating a non-financial `Contact`/`Conversation` field (e.g., marking a preference), triggering a password-reset email via the existing auth system.
- **Never allowed at Tier 0, regardless of confidence:** issuing a refund, canceling a subscription, modifying billing, or any action with financial or contractual consequence — these are Tier-2/3-only by hard policy rule (AgentCore Policy, Cedar), the same "no agent discretion on the highest-liability actions" principle already applied to Phase 5B's AR-collections tone ladder. A customer asking for a refund is, definitionally, never a Tier-0 conversation — Triage's risk axis (7C) is specifically designed to catch this before it ever reaches the Resolution Agent's auto-send path.

### 8D. Post-Resolution Follow-up & CSAT

**Reuses the Nurture & Follow-up Agent (2F)**, not a new agent — a resolved conversation triggers the same "monitor and re-engage if needed" pattern already built for sales, applied here as: send a CSAT prompt after resolution, and if the customer replies with dissatisfaction or the conversation reopens, re-trigger Triage rather than treating "resolved" as permanently final.
**Non-agentic:** CSAT capture UI/webhook, stored on `conversation.csat_score`.

### 8E. Voice — inbound handling and outbound callbacks

**Inbound:** handled by Amazon Connect (7A) at the telephony layer; Connect's Contact Flow invokes the Triage & Escalation Agent via Lambda for routing decisions, and — for Tier-0/1 voice contacts where a spoken automated resolution is appropriate — can invoke the Resolution Agent's output through Connect's text-to-speech step. Complex or Tier-2/3 voice contacts route to a live rep through Connect's queue, with Contact Lens's live transcription feeding context into the rep's screen in the queue UI (7D).
**Outbound callbacks:** genuinely reuses the Voice Agent (2E)/CALL-E, unchanged — "customer requested a callback" is just another goal template, identical in shape to a sales confirmation call.

### Value delivered in Phase 8
Grace opens her queue and the easy stuff is already answered by the time she'd have opened it; the moderately complex stuff is half-drafted with sources cited, ready for a quick review and send; the sensitive stuff lands directly in front of her with zero agent involvement in the response itself but full context already assembled. Grounded against the industry benchmarks this design targets (see §Phase 9 for the full comparison), a well-scoped Tier-0/1 split should land ImpulsoIQ in the 70%+ auto/assisted-resolution range industry leaders report, without chasing full automation at the cost of the CSAT gap that shows up whenever a platform pushes past what its grounding can actually support.

### Exit criteria
Tier-0 auto-resolve running with a measured, monitored confidence-gate rejection rate (i.e., the system is verifiably choosing "route to human" over guessing, not just claiming to); Tier-1 drafts showing a healthy send-without-major-edit rate in Evaluations; zero Tier-0/1 leakage into financial/contractual actions (verified via Cedar policy audit, not just code review).

---

## PHASE 9 — Support Insight & Continuous Improvement

### Objective
Turn the resolution activity Phase 8 generates into synthesized management insight and a continuous quality-improvement loop — mirroring Phase 3's role exactly, and, new here, closing the loop back into the CS renewal/save motion (Phase 5E) so a support pattern becomes a churn signal, not a dead end.

### Entry criteria
Phase 8 complete and generating real resolution data across a full operating cycle.

### 9A. Support Insight Agent

**Persona:** Chen or Grace's own manager.
**Task removed:** manually pulling CSAT/SLA/backlog numbers into a spreadsheet to understand whether the support function is actually healthy.
**End-to-end implementation:** identical architectural pattern to Forecasting & Insight (3A) — Code Interpreter does the actual computation (deflection rate, resolution rate, first-response time, average handle time, CSAT trend, backlog-by-queue, SLA-breach rate), the LLM layer narrates it into plain-language flags ("Tier-1 draft acceptance rate dropped 8 points this week in the Billing queue — the knowledge base may be stale on the recent pricing change"). Written to the same dedicated read-optimized reporting store (3A), rendered on a non-agentic dashboard.
**Industry-benchmarked targets, grounded in current external data** (used as the yardstick this dashboard measures against, not a claim about what ships day one): median tier-1 deflection across enterprise CX programs currently clusters around 41%, with top-quartile programs reaching ~59%; leading AI-support deployments report full end-to-end resolution rates around 66–76%, with 80%+ considered best-in-class on well-scoped, high-structure intent mixes; AI-handled CSAT typically runs 4.1/5 against 4.3/5 for pure human handling — a real but narrow gap that **hybrid escalation (exactly the Tier-0/1/2/3 model built in Phase 7–8) narrows to roughly 0.05 points**, versus a much wider gap when a platform pushes toward full automation without a reliable human-escalation path.

### 9B. Knowledge-Base Gap Detection

**Reuses Support Insight Agent's synthesis, feeding a Control Panel-style approval queue item** — not new agentic capability, but a specific, valuable output of it: recurring question patterns with no matching published `knowledge_article`, or articles whose confidence-gate rejection rate (8A.4) is unusually high, are surfaced to whoever owns KB content as a prioritized "write this article" backlog — closing the loop on Phase 8's confidence gate rather than letting "insufficient grounding" silently repeat forever.

### 9C. Continuous Quality Loop (Evaluations, extended)

**Phase 3D's Evaluations pipeline gains support-specific criteria:** Triage tier-classification accuracy against human-corrected tiers; Resolution Agent groundedness (does the citation actually support the claim — a hallucination-detection check specific to this agent's factual-accuracy requirement); confidence-gate calibration (is the agent rejecting appropriately, or too conservatively/aggressively relative to actual outcomes); CSAT-by-tier, tracked separately, so a degrading Tier-0 experience is caught before it drags down the aggregate number.

### 9D. Closing the Loop with CS Renewal/Save (Phase 5E)

**No new agent — a new trigger relationship between two already-built capabilities.** A `conversation`'s tier pattern, sentiment trend, and resolution outcome now feed directly into the Forecasting & Insight Agent's renewal-risk scoring (3A/5E) as an additional signal alongside usage decline — a customer with repeated Tier-2/3 escalations and declining post-resolution CSAT is exactly the renewal-risk profile 5E's save-call motion exists to catch, and now it's the same data feeding both, rather than support and CS operating on separate pictures of the same customer.

### Value delivered in Phase 9
A manager gets the same kind of synthesized, plain-language operational read Phase 3 already gives pipeline management — now for support health — and the knowledge base stops silently decaying because every gap it causes is now visible and prioritized, and a support pattern that used to live and die in a ticketing system now directly informs whether Grace makes a save call.

### Exit criteria
Support Insight dashboard live and tracked against the benchmark targets in 9A; KB-gap backlog actively closing gaps (measurable drop in confidence-gate rejection rate over time on repeat-topic gaps); renewal-risk scoring (3A) verifiably incorporating support signal, not just usage signal.

---

## 3. Master Feature-to-Agent-to-Phase Matrix — Phases 7–9 additions

| # | Feature | Delivered by | Phase |
|---|---|---|---|
| 25 | Omnichannel conversation unification (email/chat/SMS/voice/social) | Non-agentic data model + Amazon Connect (voice/chat transport) | 7 |
| 26 | Inbound contact triage & four-tier classification | Triage & Escalation Agent | 7 |
| 27 | Skill/capacity-based routing, SLA tracking & breach escalation | Deterministic routing + SLA policy engine (non-agentic) | 7 |
| 28 | Rep queue/conversation UI, presence, internal notes | Non-agentic UI over the same event/subscription pattern as the Control Panel | 7 |
| 29 | Knowledge base authoring/versioning | Non-agentic UI; embedding pipeline built, not yet consumed | 7 |
| 30 | Grounded auto-resolution (Tier 0) & draft-for-review replies (Tier 1) | Resolution Agent | 8 |
| 31 | Confidence-gated escalation on insufficient grounding | Resolution Agent (self-override of Triage's tier) | 8 |
| 32 | Macro/canned-response suggestion | Human-authored content + agent-suggested matching | 8 |
| 33 | Scoped, hard-gated Tier-0 action surface (never financial/contractual) | Cedar policy enforcement | 8 |
| 34 | Post-resolution CSAT capture & reopen handling | Nurture & Follow-up Agent (reused) | 8 |
| 35 | Inbound voice handling & outbound callback | Amazon Connect (transport) + Voice Agent/CALL-E (callbacks, reused) | 8 |
| 36 | CSAT/SLA/backlog/deflection insight dashboard | Support Insight Agent | 9 |
| 37 | Knowledge-base gap detection | Support Insight Agent (synthesis output) | 9 |
| 38 | Support-side continuous evaluation (groundedness, tier accuracy) | AgentCore Evaluations, extended | 9 |
| 39 | Support signal feeding renewal-risk scoring | Forecasting & Insight Agent (new input, no new agent) | 9 |

---

## 4. Full Agent/AgentCore-Service Cross-Reference — Phases 7–9 additions

| Agent | Phase | Runtime | Memory | Gateway | Identity | Policy | Observability | Evaluations | Browser | Code Interpreter |
|---|---|---|---|---|---|---|---|---|---|---|
| Triage & Escalation | 7 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (from P9) | | |
| Resolution | 8 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Support Insight | 9 | ✓ | | ✓ | ✓ | | ✓ | | | ✓ |

---

## 5. Model Tiering Strategy — Phases 7–9 additions

Consistent with §5 of v3: Nova 2 Lite, medium thinking, remains the default for both new reasoning-heavy agents (Triage & Escalation, Resolution). No case for a cheaper tier here, unlike the Signal Listening Agent's high-volume first-pass filter — every inbound support contact deserves a properly-reasoned triage decision, since the cost of a wrong tier (a Tier-3 conversation mis-classified as Tier-0) is categorically worse than the cost of the extra reasoning tokens. Support Insight's actual computation (SLA/CSAT/deflection math) follows the same "Code Interpreter does the math, the model narrates" pattern already established for Forecasting & Insight (3A) — no change to that principle here.

---

## 6. Cross-Phase Dependency Summary — extended

- **Phase 7 depends on Phases 1–6's** proven agent roster and governance patterns (single-writer service, Cedar policy, Control Panel pattern) before being extended into a new, customer-facing-response domain — the same "earn it before repointing at higher stakes" logic already applied to Phase 5B.
- **Phase 8 depends on Phase 7's** triage accuracy being proven (even in shadow mode) before any tier is allowed to act automatically — an unproven triage layer feeding an auto-resolve agent is the one sequencing risk in this whole addition worth calling out explicitly, since a mis-tiered Tier-0 conversation is the failure mode with the most direct customer-facing consequence in the entire plan.
- **Phase 9 depends on Phase 8's** real resolution volume to have anything to synthesize, exactly mirroring Phase 3's dependency on Phase 2.
- **Phase 9 feeds back into Phase 5E** (CS renewal/save) — the first place in this plan where a later phase's output becomes a new input to an earlier phase's agent, rather than every dependency running strictly forward. This is intentional and is the concrete proof of the "one continuous relationship" narrative: the system doesn't just add a new department, it makes the existing departments smarter about each other.

---

*(§7 onward from v3 — the redone cost-projection table, and all v1–v3 content not restated above — carries forward unchanged and is not duplicated here for length; refer to `impulsoiq-implementation-plan-v3-phased.md` for the complete Phase 1–6 text.)*
