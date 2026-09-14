# ImpulsoIQ — Commercial Build Plan v5

**Sell a trustworthy agentic workspace. Sequence work from the live codebase, not from the hackathon roadmap.**

| | |
|---|---|
| **Status** | Active — product track |
| **Supersedes for sequencing** | Implementation Plan v4 (`impulsoiq-implementation-plan-v4-phased.md`) as the *calendar of what to build next*. v4 remains useful as agent/feature encyclopaedia. |
| **Grounded in** | Code review vs PRD v4 (Sep 2026) · current market/regulatory research (sources in §12) |
| **Non-goal** | Hackathon deliverables, demo theatre, timeline compression |

This plan assumes ImpulsoIQ is a B2B product people pay for. Activation is **a tenant completing one inspectable agent loop that produced a real CRM outcome** — not a dashboard visit, not a chat turn, not a fixture ticket.

---

## 0. How this differs from Implementation Plan v4

v4 is a *capability catalogue* ordered as if Phases 1–6 were already production-complete. They are not. The repo has the **roster and the graph**, with **hollow product surfaces** and **stubs on the path a buyer will audit**.

v5 reorders around **willingness to pay**:

1. An agent that can be **stopped, inspected, and consented** is a product. An agent that cannot is a liability.
2. **Goal → clarify → execute → inspect** is the wedge. CRM lists without that loop are a worse HubSpot.
3. **Contact center ships after** the outbound loop is billed, governed, and trusted. Support is the second product surface, not the first invoice.
4. **Workspace templates stay dormant in the UI** until the same primitives work for sales. Expanding departments before the loop is sellable multiplies unfinished work.

v4’s agent roster and Connect-vs-CALL-E decision **stand**. What changes is *when* unfinished pieces become blocking.

---

## 1. Research premises (why the sequence looks like this)

These are design constraints, not slogans.

### 1.1 Agentic SaaS is a system of surfaces, not a chatbot

Operational work (state a goal, approve a send, escalate) belongs in an **intent surface**. Insight (pipeline, channel efficacy, SLA) belongs in **purpose-built views**. Control (pause, gates, policy) and governance (audit, consent, retention) **cannot live in a chat thread**.

Sources: *The UI of Agentic SaaS* (Apr 2026); Mantlr *Conversational UI Replacing Dashboards* (2026) — hybrid is the production pattern; pure chat is niche; monitoring dashboards survive.

**Implication for ImpulsoIQ:** conversational Home is the default *entry*. Control Panel, CRM, and later Support Queue remain first-class. Do not collapse the product into Jasper-only or Fenisco-only.

### 1.2 Activation is first *outcome*, not first *screen*

B2B activation is the account completing a workflow that predicts reuse. Product tours that orient to chrome do not activate. Elite PLG still talks about minutes-to-value; for an agentic revenue product the honest first value is **“I set a goal, I saw the agent’s draft or call plan, I approved or killed it.”**

Sources: Ahsun Mahfuz *B2B SaaS Activation Metrics*; ProductQuant activation benchmarks; Flint / PLG conversion stats (opt-in trial ~18% median conversion; activation strongly predicts paid).

**Implication:** Phase 2 exists to make that path possible. Phase 3 chrome without Phase 2 is decorating an empty machine.

### 1.3 2026 buyers do not buy autonomous spray

The AI-SDR category split: fully autonomous cold-volume broke on **deliverability** and **brand trust**. Durable deployments are **hybrid** — AI for research/draft/sequence/log; humans on targeting, first-touch, judgment, and commitments. Voice without HITL booking destroys the trust that makes voice work. Disclosure does not kill conversion; deception does.

Sources: Stackswap *Why AI SDRs Are Failing in 2026*; Digital Applied *AI SDR Agents 2026 Buyer’s Guide*; TwinsAI HITL workflow; Rafiki *AI Voice SDR Done Right*.

**Implication:** Default new tenants to **approval on first N irreversible actions**. Autonomy is an earned setting, not the onboarding default. Control Panel is the sales motion.

### 1.4 Disclosure and consent are engineering, not legal copy

**EU AI Act Article 50** transparency obligations applied **2 August 2026**: systems that interact directly with people must inform them they are interacting with AI, **clearly, at the first interaction** (spoken on a call — not a privacy policy). Machine-readable marking has a later carve-out; the interaction disclosure does not.

**US TCPA:** FCC FCC-24-17 — AI-generated human voices are “artificial or prerecorded.” Outbound marketing calls need **prior express written consent**. Informational calls still need prior express consent. DNC and calling windows remain.

Sources: Morgan Lewis (Aug 2026) on Article 50; VoiceDock / LeadHaste on voice agents; FCC declaratory ruling.

**Implication:** Phase 1 includes **recorded disclosure on every outbound call**, consent hard-gate (already sketched), real DNC, and fail-closed when checks cannot run. This is table stakes to *sell* voice in US/EU, not a Year-2 compliance project.

### 1.5 Enrichment quality is a churn and deliverability feature

B2B contact data decays ~2% / month (~22.5% / year). Single-source match rates cluster ~55–70%; a **3–4 provider waterfall** is the practical coverage/cost sweet spot; beyond four providers returns flatten. Unverified emails become bounce rate, which becomes SES reputation, which becomes send-pause — already in the stack.

Sources: Unify *Waterfall Enrichment 2026*; Clay waterfall guide; Amplemarket / Devcommx Clay vs Apollo 2026.

**Implication:** Stub `enrich_from_api` cannot ship to paying outbound tenants. Phase 4 is where the product stops lying about data. Production without keys should **refuse the send**, not invent “Technology / 50 employees.”

### 1.6 Support AI is hybrid or it is a CSAT liability

Pure-AI CSAT ~4.1/5 vs human ~4.3/5; **hybrid escalation closes the gap to ~0.05**. Sentiment-heavy intents (complaints ~3.34, billing disputes ~3.61) are a CSAT hole if auto-resolved. Intercom Fin / Zendesk 2026 reporting now distinguishes contained vs verified resolution — buyers are allergic to fake deflection.

Sources: Digital Applied CX AI stats 2026; Zendesk AI agent reporting change (May 2026); Intercom platform comparison 2026.

**Implication:** Contact center phases keep FR-17 (no financial Tier-0) and empty-KB conservative routing. Do not demo Support Queue until `list_tickets` is live. Do not sell “resolution rate” as the north star.

### 1.7 Navigation: 5–8 modules, not 15 peers and not five finance pills

Left sidebar dominates complex B2B *when it has 5–8 top-level items with nested children*. Flat 20-item sidebars fail IA. Horizontal top nav works for **3–6 true product modes** (HubSpot: Contacts / Conversations / Marketing / Sales). Fenisco-style pill bars work for shallow finance apps; ImpulsoIQ will grow Support, Templates, Registry — so **HubSpot hybrid** (mode bar + in-context tabs) is the scalable read, not a 1:1 Fenisco clone.

Sources: Cybertize *SaaS UX Benchmark 2026–27*; RIVER *IA for complex enterprise apps* (spine of 5–8); SaaSUI / DesignPixil nav patterns.

**Implication:** Phase 3 remodels chrome to **Home · CRM · Campaigns · Control · Support · More**, with role filtering. Icon-only rail is optional; dumping current `NAV_GROUPS` into pills is forbidden.

---

## 2. Definition of a tenant who can be charged

A paying Growth tenant can:

1. State a goal (composer or playbook) and get clarifying questions **in the product**.
2. See a plan + estimated cost **before** irreversible sends/calls.
3. Have **consent + disclosure + calling window + DNC** block illegal/unethical outbound, with the block in the audit log.
4. Approve, pause, or kill a run **and have Step Functions and in-flight work actually stop**.
5. Inspect **what happened and why** within seconds (push, not 15s poll theatre).
6. Run email (and optional SMS) on **verified** contacts; voice only with consent + allotment.
7. See usage against quota (fail **closed** on paid meters, not open).
8. Export/delete a contact and associated agent history (GDPR/CCPA path).

Until 1–5 are true, do not take card details for “AI SDR + voice.” Until 6–8, do not call the product enterprise-ready.

---

## 3. Current baseline (do not re-litigate)

Already real: 14 Strands runtimes; SFN campaign graph; CALL-E HTTP + webhook resume; Connect TF + intake Lambda; consent in coordinator + SFN + crm-write; crm-write as sole DSQL writer; Cognito tenancy; DynamoDB events; AppSync **publisher** (frontend unused); SES send-pause; workspace template **catalogue**; support **schema** and agents.

Hollow or stubbed: NL → SFN from UI; campaign create; ACP traces/cost/true kill; enrichment API; DNC; VoiceProvider class; Clarification Memory; `agent_run.agent_type` CHECK (six types only); Analytics; Accounts (`list_accounts` missing); Deep Research launch; `templatesApi.launch` unused; Support Queue/Insight; public widget; Stripe; DSAR; AgentCore Identity/Observability; OpenSearch; true S3 Vectors; landing/pricing still AI-SDR.

---

## PHASE 1 — Integrity of the machine

**Objective.** Anything an agent does is stoppable, attributable, and legally gated. No new product surface yet.

**Why first.** A buyer’s security/RevOps review will open logs, kill a run, and ask “can this call my customers without consent?” If the answer is “the button writes `failed` on a row,” you cannot sell. Article 50 and TCPA are already in force for the markets in the PRD SAM.

### 1A. Execution control that is real

- `agentRunsApi.setStatus` / campaign pause must **signal the SFN execution** (`StopExecution` / pause pattern), not only `upsert_agent_run`.
- Account-wide kill: one write that send-pause **and** stops all running executions for the tenant (extend existing SES send-pause; do not invent a third flag).
- In-flight CALL-E: best-effort cancel API if the vendor exposes it; if not, document “call may complete, no further graph steps” and surface that honestly in ACP.
- Expand `agent_run.agent_type` CHECK to the full roster (or drop the CHECK for an allowlist table). Support/deep-research/hygiene runs must be persistable.

**Touch:** `apps/web/.../AgentControlPanel.tsx`, `crm-write-service`, new/extend Lambda for SFN control, `schema.sql`.

### 1B. Control Panel as the trust product

- Subscribe the UI to AppSync `publishAgentAction` (publisher already exists). Poll is fallback, labelled as such.
- Show **step + status + consent/block reason**. Wire AgentCore Observability (ADOT / CloudWatch GenAI observability) so a run can show tool/model spans — [instrumentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-telemetry.html), [get started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-get-started.html).
- Cost line per run from metering table (tokens, enrichment, call minutes) — even if pricing UI comes later, operators need the number.

### 1C. VoiceProvider as a real seam

PRD and comments claim a vendor-swappable interface. Code is `httpx.post` to CALL-E. Extract `VoiceProvider` (`plan` / `run` / `cancel` / `result_schema`) with CALL-E as the first implementation. Keep stub **behind an env that cannot be true in prod**.

### 1D. Consent, DNC, window, disclosure — fail closed

- Production: missing `CALLE_*`, DNC provider, or consent service → **do not place the call**.
- Replace DNC stub with a real scrubber (or an allowlist of “DNC skipped: internal test numbers only” that cannot apply to tenant-imported lists).
- Persist on `call_result` / activity: `ai_disclosure_delivered_at`, local calling window decision, DNC result.
- Voice agent opening script: Article 50 first-sentence disclosure; TCPA recording-consent by jurisdiction (already in PRD §12 — implement, do not document).
- Outreach: CAN-SPAM footer/opt-out as template invariant (already intended).

### 1E. Clarification Memory and metering honesty

- Wire `query_settled_preferences` to AgentCore Memory (resource already exists; agent still returns defaults).
- `check_metering_quota`: **fail closed** for voice/enrichment in production; fail-open is a billing hole.

### Exit criteria

Kill a running campaign from ACP; SFN execution stops; events appear on the panel in <5s via push; a call without consent cannot be placed in prod; a call that is placed has a disclosure timestamp; Memory returns tenant preferences for a second session.

**Do not in this phase:** new Home UI, Stripe, Support Queue, waterfall vendors, landing rewrite.

---

## PHASE 2 — The value path (composer → clarify → run → inspect)

**Objective.** Signed-in default is intent. First session can produce an inspectable run.

**Why now.** Outcome-first onboarding beats chrome tours. Conversational UI wins when one sentence replaces twenty clicks; structured UI wins for approval and comparison (Improvado 2026). ImpulsoIQ’s PRD already specified this loop (FR-1, FR-2); the UI never grew it.

### 2A. Home (Jasper job, not Jasper clone)

- Default route after auth: `/home` (keep `/dashboard` as Overview).
- Greeting + composer (text). Voice later reuses `VoiceInterface` / ambient-interface — **mic is not a blocker**.
- Starters that call **real** APIs: e.g. “Qualify these inbound leads,” “Chase deals quiet 14+ days,” “Draft outreach for this list,” “Show running agents.”
- After submit: clarification turns in-panel (Clarification agent), then plan + cost estimate, then **Confirm** → `campaign-trigger` / `template-launcher`.
- Land on **Control Panel filtered to that run**, not a chat that pretends completion.

### 2B. Campaign create is a product

- Replace dead “New campaign” with the same goal payload Home uses.
- Persist `goal`, `guardrails`, `requiresApproval`, target segment, channels.
- Default `requiresApproval = true` for first 20 sends / first 5 calls per tenant (HITL calibration). Tenant setting to loosen later.

### 2C. Wire launches that already exist

- `templatesApi.launch` from Workspace **and** from Home starters (sales templates only until Phase 6).
- Deep Research: either wire launch + Swarm **approval gate** (`event.approved`) or hide the page. No disabled primary button in a sold product.

### 2D. Instrumentation

Events (account-scoped): `goal_submitted`, `clarification_completed`, `run_started`, `approval_acted`, `first_outbound_sent`, `first_call_placed`, `run_inspected`. Activation = `first_outbound_sent` **or** `approval_acted` on a draft, plus `run_inspected` within 24h.

### Exit criteria

New user: sign up → Home → clarify → approve first email (or kill) → see it in ACP, under 15 minutes on a seeded ICP list. No visit to Contacts required.

**Do not:** rebuild all CRM pages; turn on recruiting/AR templates in Home; ship Support as a starter.

---

## PHASE 3 — Operator chrome and CRM that holds a day’s work

**Objective.** Daily navigation and records match a revenue team’s job, without 15 peer nav items.

**Why now.** After the loop exists, people live in lists, pipeline, and exceptions. Hybrid IA: HubSpot-like **modes**, nested CRM/Support tabs, global search/account in the header. Role-aware nav (enterprise skill, and missing today).

### 3A. Information architecture

| Mode (top or icon rail) | Children |
|---|---|
| Home | Composer (default) |
| CRM | Contacts, Companies (`/accounts` via `list_accounts`), Deals (kanban), Activity |
| Campaigns | Campaigns, Sequences (stub route ok if Phase 4 fills it) |
| Control | Runs, Approvals inbox, Usage |
| Support | Hidden until Phase 7 exit, or “Coming” for Growth+ only |
| More | Templates, Registry, Settings, Enterprise |

- Filter by Cognito role: members do not see Registry/Enterprise.
- Remove decorative ⌘K or implement command palette (Home composer + record search).
- Do **not** clone Fenisco KPI density onto Home.

### 3B. CRM completeness (sales wedge)

- `list_accounts` + account page; stop grouping in the client.
- Contact/deal **create** that calls existing upserts; empty-state CTAs that jump to Home with a prefilled starter.
- **Activity timeline** on contact (human + agent, already one `activity` table).
- Dedup: Data Hygiene proposals as an Approvals inbox (agent exists; no UI). No silent auto-merge (FR-13).

### 3C. Approvals as a queue

SFN already `waitForTaskToken` on email approval. Build **Approvals** in Control: diff of draft, contact context, Approve/Edit/Reject → `SendTaskSuccess` / failure. This is the HITL product 2026 buyers are shopping for.

### Exit criteria

A manager can approve a send from Approvals, open the contact timeline, and find the account without a fake aggregation. Nav has ≤8 top items. Support is not in the primary spine until it works.

---

## PHASE 4 — Outbound quality (what renewals are made of)

**Objective.** Data and send path good enough that a RevOps buyer will keep the product after 90 days.

**Why now.** Stub firmographics and unverified emails are how AI-SDR tools get fired. Waterfall of **three to four** sources + SMTP verify is the 2026 architecture, not “one licensed API someday.”

### 4A. Enrichment as a first-class record

- `enrichment_record` (source, field, value, confidence, fetched_at, decay_policy) — PRD entity; today JSON blob only.
- Waterfall: internal history → provider A → B → C → email verify. Stop at first high-confidence email. Cap at four paid calls (Unify 2026 diminishing returns).
- Production without providers: enrichment step **fails with a human-visible gap**, never placeholder industry/headcount.
- Hygiene decay triggers already conceptually in data-hygiene — drive them off `fetched_at`.

### 4B. Sequences

- Sequence entity or campaign playbook steps: email / SMS / wait / call / task. Outreach already sends; the **product** is the cadence the user can edit.
- Brand-voice settings UI (read path exists: `get_brand_voice_profile`).
- LinkedIn-assisted: **out of this phase** unless a real API is contracted. Do not label “LinkedIn” on landing until then.

### 4C. Deliverability and voice SLOs

- Surface send-pause reason in ACP (Lambda exists).
- Track: consent blocks, bounce, connect rate, schema-validation pass rate on `call_result` (PRD NFRs).
- Voicemail/hold: remain CALL-E’s job; assert outcomes in `call_result.outcome` and fail the graph on malformed schema.

### Exit criteria

Enrichment writes attributed sources; unverified emails cannot send without an explicit override; sequences editable; usage/cost visible per campaign.

---

## PHASE 5 — Commercial envelope

**Objective.** Someone can pay, self-serve, and leave with their data.

**Why now.** Pricing in the app today is three static cards, no Free tier, no contact-center add-on, no Stripe. PRD §13 and unit economics are unused. You cannot “sell” without a meter that matches COGS (inference + CALL-E + later Connect).

### 5A. Billing

- Stripe: Free / Starter / Growth / Enterprise (custom).
- Free: 1 seat, CRM, research + draft + **human-approved** send, **no voice** (PRD). Instrument conversion from `first_outbound_sent`.
- Usage packs: call minutes, enrichment records, concurrent runs — same metering table, **fail closed**.
- Contact center **not** in Starter; Growth add-on / Enterprise included — but the module stays off until Phase 7 exit.

### 5B. Positioning copy

Landing, pricing, terms: **agentic workspace, sales wedge**. Control Panel and consent as the hero, not “replace your SDR.” Contact center mentioned as roadmap/module, not a live feature.

### 5C. Trust paperwork in-product

- DSAR: export/delete contact + agent history (GDPR/CCPA).
- Audit export from DynamoDB events (FR-8/11).
- Enterprise SSO: `auth/sso.tf` is conditional — productize tenant-admin metadata upload on `/enterprise`.
- SOC2 control mapping can stay in Enterprise settings **if** the controls are real (CloudTrail already; kill switch from Phase 1).

### Exit criteria

Card checkout; Free user hits a voice paywall with a true explanation; a DSAR export contains consent + call metadata; marketing claims match shipped gates.

---

## PHASE 6 — Workspace expansion (second department)

**Objective.** Prove the platform thesis **once sales HITL is retained**.

**Why now.** NRR in the PRD depends on cross-sell. Doing it earlier forks an unfinished sales product into five unfinished products. CS/renewals (Grace) is the first expansion: same contacts, same voice, same Control Panel — highest narrative overlap with later support.

### 6A. Templates that execute

- Recruiting / vendor / appointments: enable in Home **after** CS template has a paying design partner.
- AR template: keep legal-review gate (`template-launcher` already special-cases this). Do not self-serve AR.

### 6B. Insight surfaces (not chat)

- AnalyticsPage: channel efficacy from `activity` + `call_result` (add reply/open events or stop claiming reply rate — today’s schema cannot answer email reply).
- Role dashboards: rep vs manager (pipeline + agent ROI vs personal queue).
- Forecasting-insight agent already scheduled — **read** its reporting table into Overview.

### Exit criteria

One non-sales template used in production by a design partner; manager dashboard shows agent-sourced vs human-sourced pipeline.

**Do not:** build contact center in this phase.

---

## PHASE 7–9 — Contact center (v4 Phases 7–9, re-gated)

Keep v4’s split: foundation → resolution → insight. **Entry criterion changes:** Phases 1–5 complete for the tenant’s outbound loop; Connect remains transport; ImpulsoIQ agents remain reasoning (v4 §7A stands).

### Phase 7 — Foundation (sell a queue, not a diagram)

- `list_tickets` (join ticket → conversation → contact, order by SLA).
- Support Queue **calls** `supportApi`; AppSync or equivalent for SLA tick.
- Presence (`rep_status`), grab/assign/escalate/close via crm-write.
- Connect: per-tenant or pooled inbound numbers; `connect-intake` → triage. Hide Support nav until a tenant has a number **or** email ingest (`contact-forwarder`) producing conversations.
- KB: write/publish from UI (today mostly search). Conservative: **Tier 0 off** until N published articles (PRD open question #6 — default conservative).

### Phase 8 — Resolution

- Resolution agent already blocks financial actions — keep as policy, add evaluations on false Tier-0.
- Draft-for-review lands in Approvals (same inbox as outbound).
- Outbound callbacks: existing Voice agent + Phase 1 disclosure.
- Embeddable widget (FR-21): public tenant-scoped credential, CORS, rate limit — **this is how SMB support attaches**, not a Connect seat.

### Phase 9 — Insight and the loop

- HTTP read of support-insight reports (page is empty for this reason).
- CSAT capture Lambda exists — wire UI + Nurture follow-up.
- `get_support_signals_for_contact` → forecasting renewal-risk (FR-20). Measure “% accounts where support signal changed risk” as the thesis KPI.
- Price Connect usage on the Phase 5 meter (per-conversation, not unlimited).

### Exit criteria (center)

A rep clears a live queue; a Tier-3 refund request cannot be auto-resolved; a widget conversation is the same `conversation` as email; insight numbers come from tenant data; CSAT-by-tier is visible.

---

## PHASE 10 — Platform depth (scale, not novelty)

Only after something is sold.

- Public API + customer MCP (FR-14 / Clay-mindshare). Internal Gateway is not this.
- OpenSearch over contacts, transcripts, agent logs.
- S3 Vectors as **vector index**, not a labelled bucket; Resolution retrieval uses it.
- AgentCore Identity least-privilege per tool (today IAM on the runtime role is coarse).
- Second `VoiceProvider` (dependency risk in PRD §14).
- i18n / CALL-E language set.
- Lead-router: replace mock SDR rotation with real assignment.

---

## 4. Dependency graph (read this before staffing)

```
Phase 1 integrity ──► Phase 2 value path ──► Phase 3 chrome/CRM
         │                    │                      │
         │                    ▼                      ▼
         │              Phase 4 quality ◄────────────┘
         │                    │
         │                    ▼
         └────────► Phase 5 commercial ──► Phase 6 expansion
                                              │
                                              ▼
                                    Phases 7–9 contact center
                                              │
                                              ▼
                                         Phase 10 platform
```

Parallelization that is safe: Phase 1C/1D (voice/compliance) alongside 1A/1B (control). Phase 5 copy can draft in parallel with 4; **checkout waits for 1E fail-closed meters**. Support UI implementation can start in parallel **behind a flag** after 1A schema/ACP patterns exist, but **nav and pricing must not claim it live**.

---

## 5. Explicit anti-patterns

| Anti-pattern | Why it kills a product you intend to sell |
|---|---|
| Shipping Home that chats to ambient-interface without SFN | Users think the product works; nothing hits CRM |
| ACP pause that only updates DSQL | First due-diligence failure |
| Placeholder enrichment in production | Bounces + “AI slop” churn |
| Support Queue with empty fixtures or unused APIs | Trust hole; 2026 buyers know fake deflection |
| Autonomous send as default | Category is allergic; HITL is the wedge |
| 15-item sidebar *or* 12 top pills | IA failure; use 5–8 modes |
| Fenisco dashboard as Home | Conflicts with intent-first activation |
| Contact center before billing + outbound trust | Second COGS engine with no buyer |
| Fail-open metering | Negative gross margin on voice |

---

## 6. What “done” looks like per buyer persona (sales wedge)

| Persona | First value | Recurring value |
|---|---|---|
| Dara (founder) | Home → approved first sequence to 20 contacts | ACP + deals moving |
| Malik (SDR) | Approvals queue of drafts, not a blank CRM | Activity quotas without spreadsheet |
| Priya (AE) | Kill/pause on *her* accounts; call transcripts on the deal | Follow-up without looking robotic |
| Chen (buyer) | Consent log, kill switch, usage vs cost, role dashboards | ROI: agent-sourced pipeline |

Support personas (Kavi/Priyanka) are **Phase 7–9 only**. Do not use them in sales onboarding.

---

## 7. Suggested staffing slices (not a calendar)

Treat as **work packages**, not weeks:

1. Execution control + AppSync ACP + schema CHECK  
2. VoiceProvider + disclosure/DNC fail-closed  
3. Home + clarification UI + campaign create + trigger  
4. Approvals inbox (SFN task tokens)  
5. IA remodel + `list_accounts` + timeline  
6. Enrichment waterfall + enrichment_record  
7. Stripe + quotas + DSAR  
8. Analytics from real events  
9. Support list_tickets + queue + KB write  
10. Widget + Connect tenant onboarding  
11. Insight + renewal-risk loop  

Packages 1–3 are the critical path to something sellable. 4–7 make it renewable. 9–11 are a second SKU.

---

## 8. Relationship to existing docs

| Doc | Role after v5 |
|---|---|
| PRD v4 | Still the product *what* and FRs |
| Implementation Plan v4 | Agent internals and Connect decision; **do not use its “Phase 0–5 calendar”** |
| This document | **What to build next from the actual repo** |
| Architecture v1 | Update when VoiceProvider, Observability, and `enrichment_record` land |

---

## 9. Sources (accessed Sep 2026)

- [The UI of Agentic SaaS](https://akashyap.ai/the-ui-of-agentic-saas/) (Apr 2026)  
- [Conversational UI Replacing Dashboards](https://mantlr.com/blog/conversational-ui-replacing-dashboard) (Mantlr, 2026)  
- [Conversational UI vs buttons](https://improvado.io/blog/conversational-ui-vs-buttons) (Improvado)  
- [B2B SaaS activation metrics](https://ahsunmahfuz.com/blog/b2b-saas-activation-metrics/)  
- [SaaS activation benchmarks](https://productquant.dev/blog/saas-activation-rate-benchmarks/)  
- [B2B trial conversion stats](https://www.flint.com/articles/b2b-saas-free-trial-conversion-rate-statistics)  
- [Why AI SDRs are failing in 2026](https://stackswap.ai/why-ai-sdrs-are-failing-2026)  
- [AI SDR 2026 buyer’s guide](https://www.digitalapplied.com/blog/ai-sdr-agents-2026-buyers-guide-landscape-pricing)  
- [HITL AI SDR workflow](https://www.twinsai.com/blog/ai-sdrs-do-not-work-here-is-the-human-in-the-loop-ai-workflow-that-does)  
- [AI voice SDR + HITL](https://getrafiki.ai/ai-sales/ai-voice-sdr-human-in-the-loop-booking-buyer-trust/)  
- [EU AI Act Art. 50, 2 Aug 2026](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2026/08/eu-ai-acts-transparency-rules-what-went-into-effect-on-2-august)  
- [Art. 50 and voice agents](https://voicedock.ai/en/insights/eu-ai-act-article-50-voice-agents)  
- [FCC-24-17 AI voices under TCPA](https://www.fcc.gov/document/fcc-confirms-tcpa-applies-ai-technologies-generate-human-voices)  
- [Waterfall enrichment 2026](https://www.unifygtm.com/explore/waterfall-enrichment-b2b-contact-data)  
- [Clay waterfall guide](https://www.clay.com/guides/waterfall-enrichment)  
- [CX AI statistics 2026](https://www.digitalapplied.com/blog/customer-service-ai-agent-statistics-2026-data)  
- [Zendesk AI resolution reporting](https://support.zendesk.com/hc/en-us/articles/10677925692698-Announcing-changes-to-AI-agent-reporting)  
- [SaaS UX benchmark 2026–27 (nav)](https://cybertizeweb.com/blog/ui-ux/saas-ux-benchmark-report-2026-27/)  
- [IA spine 5–8 items](https://rivergroup.ai/insights/information-architecture-complex-enterprise-apps)  
- [AgentCore Observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-get-started.html)  
