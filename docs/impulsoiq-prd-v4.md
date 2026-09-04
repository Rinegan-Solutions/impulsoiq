# ImpulsoIQ — Product Requirements Document (v4)

**The Agentic Business Workspace: Sales, Revenue Operations, and Customer Service, Reimagined for the Agent Era**

| | |
|---|---|
| **Document owner** | Blessyn |
| **Version** | 4.0 |
| **Status** | Active — dual hackathon submission + production track |
| **Supersedes** | ImpulsoIQ PRD v3 (sales/RevOps-only workspace framing) |
| **Target hackathons** | 1) *Agents for Humans* (AWS — Strands Agents SDK + Bedrock AgentCore), Professional Agents track, deadline Sep 14, 2026 · 2) *CALL-E: Your Code Is Calling* (voice-calling agent platform), deadline Sep 14, 2026 |
| **Production intent** | Enterprise-grade, standalone commercial product — hackathon submission is a checkpoint, not the ceiling |
| **Companion doc** | Implementation Plan v4 (`impulsoiq-implementation-plan-v4-phased.md`) — full phased agent-to-feature build plan, including the contact center's Phases 7–9 |

---

## 0. What Changed in v4 (Changelog)

v3 established the "agentic business workspace" repositioning and the AWS Strands/AgentCore/CALL-E stack. v4 adds a second full product surface — an **agentic customer service contact center** — built out through the same design discipline as everything else in this document, not appended as an afterthought:

1. **A native, fully-matured contact center**, not a third-party ticketing integration. Omnichannel conversation unification (email, chat, SMS, voice, social), four-tier triage/escalation, grounded auto-resolution and draft-assist, skill/capacity-based routing, SLA management, and support-side insight reporting — detailed in full in §7.4 and phased as Phases 7–9 of the Implementation Plan.
2. **Amazon Connect enters the architecture** as the inbound telephony and omnichannel routing backbone, deliberately kept separate from — and complementary to — CALL-E, which remains the platform for every outbound call across the product (§8.5).
3. **Two new specialist agents** (Triage & Escalation, Resolution) plus one new insight agent (Support Insight) join the roster; every other capability the contact center needs — outbound callbacks, post-resolution follow-up, macro suggestions, renewal-risk feedback — reuses agents already defined in v3 (§7.4.7).
4. **The core narrative sharpens**, not just the feature list widens: v3 argued the same agent runtime could serve departments beyond sales. v4 proves the harder version of that claim — the same agents serving *both directions* of a single customer relationship, inbound and outbound, closing a loop (support signal feeding renewal-risk scoring) that a stitched-together stack structurally cannot close (§2.2).

Everything below is written fresh against these changes, grounded in current market data on AI-driven customer service performance (resolution rates, CSAT, cost-per-resolution) alongside the market, competitive, and unit-economics research carried forward from v3.

---

## 1. Executive Summary

ImpulsoIQ is an **agentic business workspace** — a CRM, marketing automation, lead-generation, and now **customer service contact center** platform where autonomous AI agents, not humans, perform the repetitive, judgment-light work that eats a business professional's day: researching accounts, enriching contact data, writing and sending sequences, scoring and routing leads, **making and receiving real phone calls** to qualify prospects, confirm meetings, and chase follow-ups, and — new in this version — triaging, resolving, and routing inbound customer conversations across email, chat, SMS, voice, and social. A human sets the goal and the guardrails; the agents do the work; every action the agents take is visible, inspectable, and reversible in a purpose-built **Agent Control Panel**.

The category ImpulsoIQ is entering — CRM plus sales engagement plus AI SDR tooling plus AI-driven customer service — is large, fragmented, and going through the same platform shift agents are bringing to every knowledge-work category: from *software you operate* to *software that operates on your behalf*. The global CRM software market is forecast at roughly **$103–126B in 2026**, growing toward **$250–320B by the early 2030s**; the narrower sales-software segment (CRM + sales engagement) is estimated at **~$36B in 2026**, growing at a ~15% CAGR; and the AI SDR / AI sales-agent sub-segment — the part of the market ImpulsoIQ was originally built for — is the fastest-growing slice of all of it. Alongside it, the **global call-center AI market** is projected to grow from roughly **$3.0B in 2026 to $13.5B by 2034** (a ~21% CAGR), and AI-driven customer-service platforms (Intercom Fin, Zendesk AI, Freshdesk Freddy) have already demonstrated the category is real, not speculative — Intercom Fin alone reports resolution rates averaging in the mid-60s to mid-70s percent across thousands of customers. Incumbents (Salesforce, HubSpot, Zendesk, Intercom) are each strong in their own lane but structurally siloed from the other: a CRM doesn't run your support desk, and a support desk doesn't know your pipeline. ImpulsoIQ's bet is that the agent, not the record — and not the department boundary — becomes the primary unit of the product, and that a transparent, auditable agent layer is what makes AI-run revenue *and* AI-run support trustworthy enough for a business to actually turn on, on both sides of the same customer relationship.

ImpulsoIQ is being built and submitted against two live hackathons that, together, force the exact architecture a serious agentic product needs: **AWS's Agents for Humans** (Strands Agents SDK + Bedrock AgentCore — the agent brain, memory, and secure runtime) and **CALL-E** (the agent's voice — real outbound/inbound phone calls with structured results). The hackathon deliverables (architecture diagram, public repo, demo video, live agent) are treated as a forcing function for good engineering discipline, not the finish line. The roadmap in this document explicitly separates "hackathon MVP" from "production system," and the scope, compliance, and unit-economics sections are written at production-grade depth regardless of the six-week build clock.

---

## 2. Product Vision & Strategic Positioning

### 2.1 Vision statement

*Every business professional should be able to say "get this done" to an agent — and trust the result — the same way they'd delegate it to a competent human report.*

### 2.2 Strategic positioning: from sales tool to agentic workspace

The core repositioning of v3 is deliberate and needs to be visible everywhere — pricing, onboarding, marketing copy, and the product's information architecture — not just in this document:

- **The wedge is sales**, because sales has the clearest ROI story (pipeline generated, meetings booked, deals closed) and the highest willingness to pay for anything that moves those numbers. ImpulsoIQ ships first as a best-in-class agentic CRM + sales engagement + lead-gen platform.
- **The platform is business-wide.** The same agent runtime (research an entity, enrich a record, draft and send communication, place a phone call, log a structured outcome, escalate to a human on ambiguity) is a general-purpose "get repetitive business work done" primitive. Once trust is established in the sales use case, the identical agents — reskinned with role-specific goals, tone, and guardrails — extend to recruiting coordination, customer success renewals, accounts-receivable follow-up, vendor/supplier coordination, event and meeting logistics, and market/competitive research.
- **Positioning statement:** *ImpulsoIQ is the agentic workspace where revenue and operations teams delegate outreach, follow-up, and relationship upkeep — by email, message, and now phone — to AI agents they can see, steer, and trust.*

This is not scope creep if it is sequenced correctly: v1/hackathon MVP stays tightly scoped to the sales/RevOps wedge (this satisfies "Professional Agents" judging criteria on AWS's side and "real business problem" criteria on CALL-E's side); the *workspace* framing lives in the vision, roadmap, and architecture (so nothing built for sales has to be re-architected later), without bloating the MVP surface area.

### 2.3 Why now

- **Agent-capable models crossed a reliability threshold.** Long-horizon tool use, multi-step planning, and voice-native conversation (real-time interruption handling, tone adaptation) are now good enough for unsupervised, narrow-goal execution — which is what both a cold-outreach sequence and a qualification phone call actually require.
- **Buyers are already primed.** Industry survey data cited in Salesforce's 2026 State of Sales research shows the large majority of sales leaders who have deployed agents call them critical to hitting targets, and most teams without a consolidated platform intend to consolidate — buyers are actively looking to replace stitched-together stacks with an agent-native one.
- **Voice was the last channel automation couldn't reach.** Email and chat sequencing has been commoditized (Apollo, Instantly, Outreach, Salesloft). Phone — still the highest-conversion, highest-trust channel for qualification, scheduling, and collections — was locked behind either expensive human BDR/SDR headcount or brittle IVR-style robocall tech that damages brand trust. A goal-driven, adaptive voice-calling agent (CALL-E) removes that barrier for the first time.
- **Market skepticism is a design constraint, not a blocker.** Buyers have been burned by "AI SDR" tools that send generic, spam-flagged copy at scale. The winning wedge is not "more volume," it's **verifiable quality and transparency** — which is exactly what the Agent Control Panel and CALL-E's structured, auditable call results are built to deliver.

---

## 3. Market Research & Sizing

### 3.1 Market sizing methodology

Third-party market-research estimates diverge (this itself is a signal of a market still being defined), so this PRD triangulates across multiple independent research firms rather than anchoring to a single figure, and builds ImpulsoIQ's TAM/SAM/SOM from a bottoms-up seat/segment count rather than accepting any one top-down number uncritically.

**Top-down reference points (2026):**

| Segment | 2026 estimate | Growth | Source pattern |
|---|---|---|---|
| Global CRM software market | ~$103B–$126B | CAGR 4–14% depending on scope (10-yr forecasts range to $250–321B by early 2030s) | Statista, Fortune Business Insights, Research and Markets |
| Sales software (CRM + sales engagement/enablement) | ~$36B, →$72B by 2031 | ~15% CAGR | Mordor Intelligence |
| Sales analytics / revenue intelligence | ~$5.5B, →$12.5B by 2033 | ~12.4% CAGR | Persistence Market Research |
| AI SDR / AI sales-agent software (sub-segment) | Fastest-growing slice of the above; North America ~43% share; AI Outreach Assistants ~28% of AI-SDR spend | Elevated double-digit CAGR (AI Sales Assistant/Conversational Intelligence forecast at ~24% CAGR through 2031) | MarketsandMarkets, Mordor Intelligence |

The spread across these numbers (a $18B CRM estimate from one firm vs. $126B from another) reflects genuine scope disagreement — some studies count only "CRM record-keeping" software, others fold in the full sales/marketing/service suite. ImpulsoIQ's own TAM below is built bottoms-up specifically to avoid inheriting that ambiguity.

### 3.2 TAM / SAM / SOM

**TAM (Total Addressable Market) — $58B.** All organizations globally that employ people in a revenue-facing or client-facing role (sales, marketing, customer success, recruiting, collections, vendor management) and could plausibly pay for software to automate outreach and follow-up for that role. Bottoms-up: ~340M knowledge workers globally touch some form of outbound relationship work; at a blended realistic ACV of ~$170/seat/year across the full spectrum from SMB self-serve to enterprise, that is the sales+marketing+service software TAM referenced above (~$100B+) discounted to the subset of that spend addressable by an agent-native, workspace-wide platform rather than single-function point tools — landing at the CRM + sales engagement + AI SDR combined figure of ~$58B.

**SAM (Serviceable Addressable Market) — $9.8B.** English-and-Spanish-first markets (North America, UK, EU core, LatAm — reflecting Blessyn's go-to-market reach and CALL-E's current regional/language coverage: US, CA, GB, AU, DE, FR, MX, BR, plus SG/MY/IN/AE/JP/VN/ID/PH/KE), mid-market and SMB companies (10–2,000 employees) in B2B-sales-heavy verticals (SaaS, professional services, real estate, financial services, healthcare services, agencies), who are current or recent buyers of a CRM, sales-engagement tool, or AI SDR point solution. This is the segment where an agentic, all-in-one platform has both budget authority within a single buyer (no six-month enterprise procurement) and genuine pain from stitched-together tool sprawl.

**SOM (Serviceable Obtainable Market) — Year 1–3 realistic capture.**
- **Year 1 (post-hackathon, first 12 months of GA):** ~1,500–3,000 paying teams, ~$1.2M–$2.5M ARR, driven by product-led self-serve signups plus hackathon/launch visibility.
- **Year 3:** ~2–3% share of SAM in the mid-market/SMB tier — ~$200M–$300M ARR — contingent on successful expansion from the sales wedge into the broader workspace positioning (Section 2.2) and at least one enterprise-tier land-and-expand motion established by month 18.

These are deliberately conservative relative to Apollo.io's own trajectory (from $0 to an estimated ~$150M ARR in roughly five years on a freemium PLG motion in a more crowded segment of this same market) — ImpulsoIQ's SOM assumes a slower ramp because voice-calling and multi-agent orchestration are higher-trust, higher-complexity purchases than a contact database.

### 3.3 Macro trends shaping the market

1. **Consolidation pressure.** The majority of sales teams without an all-in-one platform report an intent to consolidate tooling — buyers are fatigued by paying for a CRM, a sequencer, an enrichment tool, a dialer, and a calendar tool separately, then paying again in integration overhead.
2. **AI-readiness is now a CRM requirement, not a feature.** A large majority of sales leaders who have deployed agents call them critical to meeting targets — but agents are only as good as the data they can see. A rep's calls, SMS replies, no-show follow-ups, and voicemail outcomes that never make it into the CRM become blind spots for every downstream AI feature. This is a direct argument for owning both the CRM record *and* the channel (voice) that produces the data.
3. **Reps still spend a minority of the workweek actually selling** (industry surveys consistently show sales reps spend under half their time in core selling activity) — the addressable inefficiency is enormous and is exactly the "repetitive, judgment-heavy tasks that eat their day" framing AWS's own hackathon brief uses.
4. **Voice remains under-automated relative to its conversion power.** Every point-tool competitor (Apollo, Clay, Instantly, Outreach, Salesloft) has converged on email/LinkedIn-sequence automation; phone-based outreach and follow-up is still largely manual or handled by brittle legacy robocall/IVR technology that buyers actively dislike. This is the clearest whitespace in the competitive set (Section 4).
5. **SMB is the fastest-growing buyer segment** (SMB CAGR outpaces enterprise in sales-software spend) even though enterprise still holds the majority of 2025 revenue — reinforcing a PLG-first, land-in-SMB/mid-market motion as the right initial GTM shape.

---

## 4. Competitive Landscape

### 4.1 Direct and adjacent competitors

| Competitor | Core wedge | Strengths | Structural weaknesses ImpulsoIQ targets |
|---|---|---|---|
| **Salesforce** (incl. Agentforce) | System-of-record CRM, enterprise | Ecosystem depth, trust, compliance maturity, huge partner network | Expensive, high implementation overhead, agent features bolted onto a 25-year-old data model; agent actions are not transparently inspectable by default; SMB-hostile pricing and complexity |
| **HubSpot** (incl. Breeze AI) | Inbound marketing + CRM, mid-market | Strong UX, generous free tier, marketing/CRM integration, large community | Sales-engagement and voice capability are shallow relative to point tools; AI agent depth trails pure-play AI SDR vendors; enrichment quality often requires third-party tools (Clay, Apollo) layered on top |
| **Apollo.io** | Contact database + sequencing, freemium PLG | 210–275M+ contact database, functional free tier, fast PLG-driven growth (~$150M ARR, 600K+ companies onboarded), AI Assistant (GA March 2026) for list-building and sequence creation | "Mile wide, inch deep" — CRM features are basic, sequencer is good-not-great, no goal-driven voice-calling agent (its dialer is a manual/semi-automated calling tool, not an autonomous conversational agent), data decay at scale |
| **Clay** | Enrichment/workflow orchestration, 100+ data-source waterfall | Best-in-class enrichment flexibility, strong technical-buyer mindshare (leads GTM-leader tool-preference surveys), highly composable (n8n-style workflow building) | Not a CRM or system of record; steep technical learning curve; expensive at scale ($495+/mo Growth tier); requires stitching to a separate CRM and separate outreach tool — exactly the tool-sprawl fatigue buyers are trying to escape |
| **Outreach / Salesloft** | Sales engagement platforms, enterprise sequencing | Deep cadence/playbook tooling, strong enterprise sales-ops fit | Legacy category leaders now playing catch-up on native AI agents; no owned contact database (require a separate data provider, adding cost/complexity); no voice-agent capability, only call *logging/coaching* |
| **AI SDR point tools** (11x, Artisan, etc.) | Fully autonomous outbound "digital SDR" | Focused, fast to deploy, clear ROI pitch | Narrow scope (usually email/LinkedIn only), black-box execution feeds market skepticism, no CRM of record, no voice, no workspace-wide extension |
| **Zendesk / Intercom (Fin) / Freshdesk (Freddy)** *(new in v4)* | AI-driven customer service / helpdesk | Mature, high-volume-proven AI resolution (Intercom Fin: mid-60s–mid-70s% resolution rate across 6,000+ customers; per-resolution pricing models; deep helpdesk-workflow maturity) | Entirely disconnected from the sales/CRM side of the relationship — a support AI here has no visibility into deal history, renewal risk, or prior sales conversations, and a resolution here doesn't feed back into any pipeline or churn-risk signal; buying this *plus* a CRM *plus* a sales-engagement tool is exactly the stitched-together-stack problem this whole document argues against |

### 4.2 What "stealing" from the leaders actually means here

Deep-diving how the top CRM/sales companies actually built durable customer bases surfaces four repeatable growth mechanics — ImpulsoIQ's GTM (Section 12) deliberately borrows all four rather than inventing a fifth:

1. **Apollo's free-tier PLG engine.** A genuinely useful free tier (not a crippled trial) with simple per-seat pricing drove viral, sales-motion-free adoption to 600,000+ companies. ImpulsoIQ's free tier must let a solo user run a real agent (research + enrich + draft outreach) end-to-end with no credit card, not a locked demo.
2. **HubSpot's content-and-community flywheel.** HubSpot's growth was never primarily paid acquisition — it was owned educational content (the "inbound marketing" category itself) plus a large practitioner community that pulls in demand. ImpulsoIQ's equivalent is becoming the reference point for what a *transparent* agentic workspace looks like — the Agent Control Panel itself is inherently demo-able, screenshot-able, and community-shareable content.
3. **Clay's technical-credibility mindshare.** Clay wins developer/RevOps-power-user mindshare through radical composability and by being visibly used and endorsed by sophisticated GTM operators, not through advertising. ImpulsoIQ should invest early in being *usable and legible* to technical RevOps buyers (API/MCP access, exportable agent logs, no black boxes) even though the primary buyer is broader.
4. **Salesforce's land-and-expand enterprise motion.** Once trust and workflow lock-in exist at the team level, expansion into adjacent departments (support, ops, finance) is the highest-margin growth lever available. This is the direct mechanism behind ImpulsoIQ's "workspace" expansion thesis in Section 2.2 — it mirrors how Salesforce expanded from sales-cloud into service, marketing, and platform, except ImpulsoIQ's expansion unit is *agents*, not *clouds*.

### 4.3 Differentiated whitespace ImpulsoIQ occupies uniquely

- **Voice as a native, autonomous, structured-outcome channel** — not a manual dialer, not an IVR robocall, but a goal-driven agent that plans the call, adapts in real time, and returns a structured, CRM-writable result. No competitor in the table above has this today.
- **A dedicated transparency/control surface (Agent Control Panel)** as a first-class product surface, not a debug log buried in settings — directly answering the market-skepticism risk flagged in Section 10.
- **One data model spanning record, sequence, and call** — voice call outcomes, email/SMS engagement, and enrichment all write to the same entity graph in real time, closing the "blind spot" problem Salesforce's own research flags (reps' best calls and follow-ups going undocumented).
- **Workspace-wide agent reuse** — the same underlying agent primitives serve sales, CS, recruiting, and ops, which none of the point tools above are architected to do.
- **A single relationship graph spanning both directions of contact** *(new in v4)* — outbound sales/CS activity and inbound support activity write to and read from the same `Account`/`Contact` history, so a support pattern becomes a renewal-risk signal and a deal's history informs how a support ticket gets triaged. Zendesk/Intercom/Freshdesk have no sales-side data to draw on; Salesforce/HubSpot have no native, equally-mature support-resolution layer. No competitor in this table spans both today.

---

## 5. Product Viability Metrics

### 5.1 Unit economics targets (SaaS benchmarks, 2026)

Industry benchmark data across multiple 2026 SaaS unit-economics studies converges on the following reference ranges, which ImpulsoIQ's pricing (Section 13) and financial model are built against:

| Metric | Industry benchmark (2026, B2B SaaS) | ImpulsoIQ target |
|---|---|---|
| LTV:CAC ratio | Healthy range 3:1–5:1; median ~3.2:1; SMB tier trends lower (~2.5:1), enterprise tier trends higher (~4.5:1) | 3.5:1 blended by end of Year 1; 4.5:1+ by Year 3 as expansion revenue (Section 5.2) matures |
| CAC (self-serve / PLG) | $50–$600 | $150–$350 (blended free-to-paid conversion + light-touch sales assist) |
| CAC (sales-assisted / mid-market) | $1,000–$3,000 | $1,200–$2,000 for mid-market/team plans |
| CAC payback period | 6–12 months typical; elite <80 days | Target 9–12 months Year 1, trending to 6–9 months by Year 3 |
| Net Revenue Retention (NRR) | Industry median 105–115% | 110%+ target, driven by seat expansion + call-credit/agent-capacity upsell + workspace cross-sell (Section 2.2) |
| Gross margin | SaaS norm 70–85% (compute-heavy AI products often lower, 60–75%, due to inference + telephony cost) | 65–72% blended, reflecting LLM inference and CALL-E per-minute/per-call cost as a genuine COGS line (not classic SaaS-only margin) |

**Why gross margin runs lower than "classic SaaS":** ImpulsoIQ's COGS is not just hosting — every agent action (an enrichment lookup, an LLM call for drafting/reasoning, and especially every phone call placed through CALL-E) carries a marginal cost. This is modeled explicitly and priced into usage-based tiers (Section 13) rather than absorbed silently, which is also why the product must default to **agent efficiency** (don't re-research an account that hasn't changed, don't re-call a number that just hit voicemail without a backoff strategy) as a cost-control feature, not just a UX nicety.

### 5.2 LTV components specific to ImpulsoIQ

- **Base subscription revenue** (seat-based, Section 13).
- **Usage-based expansion**: call-minute/call-credit packs (CALL-E consumption), enrichment-record packs, and additional agent "capacity" (concurrent agents running) — these create a natural, consumption-driven expansion motion independent of headcount growth, which is a structurally different (and typically stickier) expansion lever than pure per-seat upsell.
- **Workspace cross-sell**: once a sales team is live, activating the same agent runtime for a second department (CS renewals, recruiting) is close to zero incremental CAC — this is the highest-leverage NRR driver in the model and the core financial argument for the "agentic workspace" repositioning in Section 2.2, not just a product-vision argument.
- **Retention drivers**: data compounding (the longer an account uses ImpulsoIQ, the richer its enriched-entity graph and call-outcome history — a genuine switching cost competitors starting from zero can't replicate) and Agent Control Panel trust (once a team has audited enough agent runs to trust the system, churn risk drops sharply — this is a hypothesis to validate explicitly via the KPI in Section 15).

### 5.3 Leading indicators to track from day one (not lagging financial metrics)

- Time-to-first-agent-run (activation speed)
- % of agent runs a user inspects in the Control Panel in week 1 (trust-building signal)
- % of AI-drafted outreach sent without edits vs. edited vs. discarded (quality signal)
- Call-to-connect rate and call-to-qualified-outcome rate for CALL-E-placed calls (channel efficacy)
- Free-to-paid conversion rate and days-to-conversion

---

## 6. User Personas

Personas are grouped by the wedge (sales/RevOps, live at MVP) and the workspace expansion tier (post-MVP, architected for from day one).

### 6.1 Wedge personas (sales & revenue — MVP scope)

**1. Solo Founder / Small-Business Owner ("Dara")**
Runs their own outbound because they can't yet afford an SDR. Needs the agent to do prospecting, drafting, and follow-up calls end-to-end with minimal setup. Price-sensitive; converts on the free tier first. *Primary jobs:* fill pipeline without hiring; never let a warm lead go cold from being too busy to call back.

**2. SDR / BDR ("Malik")**
Junior rep under quota pressure, spends most of the day on research and cold outreach rather than actual conversations. Wants the agent to handle list-building, enrichment, and first-touch sequencing (including the annoying "confirm you got my email" call), surfacing only warm, qualified conversations for Malik to take over personally. *Primary jobs:* hit activity and meeting-booked quotas; reduce time-to-first-touch on new leads to near-zero.

**3. Account Executive ("Priya")**
Owns a deal from qualified lead to close. Needs the agent to keep deals warm between her human touches — chase a signature, confirm a meeting time by phone, nudge a stalled contract — without looking robotic to the prospect. Cares intensely about the Agent Control Panel: she will not let an autonomous agent call *her* prospects without being able to see exactly what was said. *Primary jobs:* protect deal momentum; never miss a follow-up; look impeccably organized to prospects.

**4. Sales Manager / RevOps Leader ("Chen")**
Owns team quota, pipeline hygiene, and tool ROI. Needs cross-rep visibility, agent-performance analytics, and confidence that agent actions are compliant and on-brand at scale. This persona is the primary buyer for team/mid-market tier. *Primary jobs:* forecast accurately; prove tooling ROI to leadership; keep the team compliant (CAN-SPAM/TCPA) without personally policing every message and call.

**5. Marketing / Demand-Gen Lead ("Owen")**
Owns top-of-funnel campaigns and lead quality. Needs the agent layer to enrich and score inbound leads in real time and route them instantly (including a same-minute qualification call for hot inbound) before interest cools. *Primary jobs:* prove marketing-sourced pipeline; reduce speed-to-lead to minutes, not days.

**6. Customer Success / Account Manager ("Grace")**
Owns renewals, expansion, and churn prevention on the post-sale side — and, as of v4, also owns (or works alongside whoever owns) the inbound support function for her accounts. Needs the agent to run proactive check-ins, usage-risk outreach, and renewal-reminder calls on the outbound side, and to triage, resolve, and surface context on the inbound side, with both halves informing the same renewal-risk picture. *Primary jobs:* protect NRR; catch churn risk before a customer disengages entirely; resolve support issues fast enough that they never become the reason an account churns.

### 6.2 Workspace-expansion personas (post-MVP, architected for now)

**7. Recruiter / Talent Coordinator ("Ines")** — candidate outreach, interview scheduling and confirmation calls, offer follow-up.

**8. Operations / Vendor Manager ("Tomás")** — supplier confirmation calls, delivery-status follow-up, appointment/logistics coordination.

**9. Finance / Accounts-Receivable Owner ("Renata")** — polite, compliant payment-reminder outreach and calls for overdue invoices, with strict guardrails (no aggressive collections behavior; escalate to human beyond a defined threshold).

**10. Front-Desk / Admin Professional ("Sam")** — appointment scheduling and reminder calls for a services business (clinics, salons, agencies) — the clearest "everyday professional" persona connecting back to AWS's own "Professional Agents" track language (repetitive, judgment-heavy tasks that eat a professional's day).

Personas 7–10 are explicitly out of MVP scope but validate that the *underlying agent primitives* (research → draft/plan → act via message or call → log structured outcome → escalate on ambiguity) generalize — which is the architectural argument for building the agent runtime workspace-wide from day one even while the UI and packaging stay sales-first at launch.

### 6.3 Contact center personas (new in v4, post-MVP, architected for now)

**11. Support Representative ("Kavi")**
Works the inbound queue for however a customer chooses to reach out — email, chat, SMS, or phone. Wants the easy, repetitive stuff (password resets, order/invoice status, FAQ-tier questions) handled without them, the moderately complex stuff pre-drafted with sources cited so they can review and send quickly, and the genuinely sensitive stuff (refunds, upset customers) routed straight to them with full context already assembled rather than a blank ticket and a search bar. *Primary jobs:* clear the queue without burning out; never send a wrong or ungrounded answer; feel like the tooling has their back on the conversations that matter most.

**12. Support / CX Manager ("Priyanka")**
Owns queue health, SLA compliance, and CSAT for the support function — often the same person as, or a close partner to, Chen (RevOps) or Grace (CS), since support health and renewal health are the same underlying signal. Needs synthesized visibility into deflection rate, resolution rate, backlog by queue, and where the knowledge base is failing customers, without pulling numbers into a spreadsheet by hand. *Primary jobs:* prove the support function is scaling without proportionally scaling headcount; catch a degrading experience (a stale knowledge article, a mis-tiering pattern) before it shows up as churn.

Personas 11–12 depend on the same underlying agent primitives as 7–10, applied to the *inbound* half of the relationship rather than the outbound half — the concrete proof that this platform's architecture generalizes in both directions, not just across departments.

---

## 7. Product Description: What ImpulsoIQ Is and How It Works

### 7.1 Product in one paragraph

ImpulsoIQ is a CRM and revenue workspace where a user sets a goal in plain language ("qualify these 40 inbound leads and book meetings with anyone who's a fit," "chase every invoice over 30 days late," "re-engage every deal that's gone quiet for 2+ weeks") and a coordinated team of specialized AI agents — a researcher, a writer, a caller, and a coordinator — plans the work, executes it across email, SMS, and real phone calls, writes every action and outcome back to CRM records in real time, and surfaces only what genuinely needs human judgment. Every agent action is visible and replayable in the Agent Control Panel; nothing happens invisibly.

### 7.2 How it works — the agent loop

1. **Goal intake.** A human states a goal (natural language, a saved playbook, or a trigger such as "new inbound lead" or "invoice 30 days overdue"). ImpulsoIQ's Clarification agent asks any missing questions up front (who, what channel, tone, urgency, success criteria) rather than guessing — mirroring CALL-E's own "smart goal clarification" pattern, applied product-wide.
2. **Planning.** A Coordinator agent decomposes the goal into a task plan across the available agent specialists (research, enrichment, drafting, sequencing, calling) and estimates the resource cost (LLM calls, enrichment credits, call minutes) before execution, so the user can approve or adjust scope.
3. **Execution.** Specialist agents execute in parallel or sequence as the plan requires:
   - The **Research/Enrichment agent** builds or refreshes the account/contact record from first- and third-party data sources (waterfall enrichment, similar in spirit to Clay's multi-source approach but natively inside the CRM record).
   - The **Outreach agent** drafts and sends email/SMS/LinkedIn touches on-brand and on-tone, referencing the enriched context.
   - The **Voice agent** (via CALL-E integration) plans and places outbound calls for qualification, confirmation, or follow-up — handling live pickup, voicemail, screening, holds, and interruptions — and returns a structured result (outcome, transcript, next step) rather than a raw recording.
   - The **Follow-up/Nurture agent** monitors for replies, no-shows, and silence, and re-engages on a schedule without being told to.
4. **Escalation on ambiguity.** Any agent that hits a decision requiring judgment, consent, or brand risk (a prospect asks a pricing question outside its script, a customer sounds upset, a contact requests removal) stops and hands off to a human via the Control Panel, rather than guessing.
5. **Logging and learning.** Every action, message, and call outcome writes back to the unified CRM record in real time. Outcomes feed back into agent strategy (which subject lines convert, which call times connect, which script framing books meetings) — the same "in-task optimization" and "continuous improvement" principle CALL-E applies to individual calls, applied at the workspace level across the whole agent fleet.

### 7.3 Feature set

**Core CRM**
- Unified contact/account/deal data model; pipeline and Kanban views; activity timeline that includes agent-authored actions and human actions on equal footing; custom fields, objects, and pipelines; deduplication and merge tooling.

**Agentic lead generation & enrichment**
- Natural-language ICP definition → agent-built prospect lists; multi-source waterfall enrichment (firmographic, technographic, intent/buying-signal data); real-time inbound-lead enrichment and scoring; duplicate/decay detection with automatic re-enrichment triggers.

**Agentic outreach & sequencing**
- AI-drafted, on-brand multi-channel sequences (email, SMS, LinkedIn-assisted); tone/voice-of-brand configuration; A/B experimentation run and interpreted by the agent, not just logged for a human to analyze; deliverability monitoring and agent-driven send-pattern throttling to protect sender reputation.

**Agentic voice (CALL-E integration) — flagship differentiator**
- Goal-driven outbound calling: lead qualification calls, meeting confirmation/scheduling, stalled-deal check-ins, renewal/save calls, invoice follow-up calls, event/interview confirmation calls (workspace-expansion personas).
- Live call handling: natural conversation flow, interruption handling, voicemail detection and appropriate voicemail-drop behavior, hold/transfer handling.
- Structured, schema-defined outcomes returned per call (e.g., `qualified: yes/no/unknown`, `next_step`, `objection_raised`, `sentiment`) written directly to the CRM record — not a raw transcript dump the user has to interpret manually.
- Scheduled and batch calling with agent-managed pacing and retry/backoff strategy (e.g., don't immediately re-dial a hang-up; try a different time window).
- Full governance layer: number/line governance, concurrency and rate limits, blocklists, kill switches, redacted logs, and audit trails, inherited from CALL-E's built-in safety controls and extended with ImpulsoIQ-level consent and compliance rules (Section 11).

**Agent Control Panel — trust and transparency layer**
- Live view of every agent currently running, its current step, and its reasoning trace.
- Full action log per agent, per contact, per campaign — searchable and filterable, exportable for compliance review.
- One-click pause/resume/kill for any agent or any campaign.
- Approval gates: configurable checkpoints where an agent must get human sign-off before an irreversible action (e.g., "before placing calls to any contact marked VIP," or "before sending to any list larger than 200").
- Cost/consumption dashboard: LLM tokens, enrichment credits, and call minutes consumed per agent run, per campaign, per user — because in an agent-native, usage-cost product, cost transparency *is* trust.

**Custom CRM dashboards & reporting**
- Role-based dashboards (rep, manager, RevOps) with pipeline, activity, agent-performance, and channel-efficacy views (email vs. SMS vs. voice conversion by stage); exportable reports; forecast views incorporating agent-sourced pipeline separately from human-sourced pipeline so ROI is auditable.

**Marketing automation**
- Lead scoring and routing; campaign builder with agent-executed steps; landing-page/form capture with instant agent-driven enrichment and qualification of new inbound.

**Workspace extension surface (post-MVP, architected now)**
- Role-specific agent templates (recruiting coordination, AR follow-up, vendor coordination, appointment reminders) reusing the same core agent runtime and Control Panel, deployable to non-sales departments without a separate purchase or platform.

**Agentic customer service contact center (new in v4, post-MVP, architected now) — full detail in §7.4**
- Native, fully-matured contact center: omnichannel conversation unification, four-tier triage and escalation, grounded auto-resolution and draft-assist, skill/capacity-based routing, SLA management, knowledge base, and support-side insight reporting — not a third-party ticketing integration, and not a stripped-down feature bolted onto CS.

### 7.4 The Agentic Customer Service Contact Center

This is the single largest capability addition in v4 and is treated as its own product surface — with its own data model, its own human-facing UI, and its own infrastructure decision — while remaining, deliberately, part of the same agentic workspace rather than a disconnected acquisition-shaped feature. Full phased build detail lives in the companion Implementation Plan's Phases 7–9; this section covers the product-level "what" and "why."

#### 7.4.1 The narrative

Every feature described so far answers a version of the same question: *what does this professional stop doing manually once ImpulsoIQ is watching?* But there's a moment in every customer relationship none of the above touches — the instant a customer actually reaches out, confused or frustrated or just needing something small. Right now, in a typical stitched-together stack, that's the one point where the software managing the relationship goes silent and a human has to start from scratch: read the whole history, figure out what's going on, decide who should handle it, type a reply. Everything upstream (winning the account, keeping it healthy) has an agent watching it; the moment the customer talks back, nothing does.

Support is also, for a lot of businesses, the single most repetitive, most volume-heavy, most emotionally taxing "judgment-heavy task that eats the day" in the entire persona set (§6) — arguably a sharper fit for the Professional Agents framing in §1 than any single sales workflow, precisely because it's relentless: a support inbox doesn't wait for a campaign to be scheduled, it just arrives, all day, every day, and someone has to triage it.

The reframe: every other feature in ImpulsoIQ answers "who should we reach out to, and what should we say?" Support flips the question — "someone reached out to *us* — what do they need, and who's the right one to answer?" It's the same underlying agent capability (understand context, draft or place a response, know when a human has to take over), pointed at the opposite direction of the relationship. That symmetry is the product argument for building this natively rather than integrating a third-party helpdesk: ImpulsoIQ already knows this customer — deal history, renewal-risk score, every prior call transcript, every email thread. A generic support tool starting from zero has none of that.

#### 7.4.2 The value proposition

*For a support team drowning in volume and a manager who can't tell what's actually urgent, ImpulsoIQ turns every inbound customer conversation — however it arrives — into a triaged, context-loaded, appropriately-handled response: resolved instantly where it's safe to, drafted for a human where it needs judgment, and escalated straight to the right person with the full relationship history already assembled where it matters most — because the same agents that have been managing this customer all along never stopped paying attention the moment the customer spoke up.*

#### 7.4.3 Modes of interaction

- **Channels:** email, in-app live chat widget, SMS, inbound and outbound voice, and social/review-platform mentions (lighter-touch monitoring rather than full ticketing).
- **Three interaction shapes, not two** — human-direct is a first-class mode, not a fallback: (1) **agent-resolved** — low-risk, high-confidence; (2) **agent-drafted, human-sent** — agent prepares the reply, rep reviews/edits/sends; (3) **human-only, agent-assisted** — rep handles it themselves, the agent's only job is surfacing context. A rep can pull any ticket out of its default routing at any point, regardless of which mode it started in.

#### 7.4.4 Escalation as classification

Every inbound conversation is classified on arrival across two axes — complexity/confidence, and risk/sentiment — into one of four tiers, mirroring the same escalation-on-ambiguity principle already established for outbound agents (FR-7):

| Tier | Example | Handling |
|---|---|---|
| 0 — Auto-resolve | "Where's my invoice?" | Agent-resolved, logged, no human touch unless the customer pushes back |
| 1 — Draft for review | Feature question needing nuance | Agent-drafted, human-sent |
| 2 — Human required, agent-assisted | Billing dispute, negative sentiment | Routed straight to a rep with context pre-loaded |
| 3 — Hard escalate | Refund/cancellation, legal mention, repeat unresolved contact | Never touched by an agent's draft — routed to a manager/senior rep, tagged urgent, enforced as a routing rule, not agent discretion |

A defined, tenant-configurable allowlist governs what a fully-automated Tier-0 response is actually permitted to *do* beyond replying with text — informational replies, attaching a knowledge article, non-financial field updates, and triggering a password reset are permitted by default; issuing a refund, canceling a subscription, or any action with financial or contractual consequence is **never** permitted at Tier 0 regardless of confidence, enforced as a hard policy rule rather than left to agent judgment (mirroring the same no-discretion principle already applied to the AR-collections tone ladder for workspace-expansion persona Renata).

#### 7.4.5 Grounded resolution — the reliability guardrail

Every auto-resolved or drafted response must cite the knowledge-base article(s) it's grounded in. If retrieval doesn't surface a sufficiently relevant, current article, the system does not guess — it downgrades its own output to "insufficient grounding, route to human," overriding the original tier classification. An ungrounded confident answer is treated as strictly worse than an honest "I don't know, routing to a person," and the architecture makes the honest path the default failure mode rather than an edge case someone has to remember to handle.

#### 7.4.6 Industry benchmarks this design targets

Grounded in current market data on AI-driven customer service performance, not vendor marketing claims: median tier-1 deflection across enterprise CX programs currently clusters around **41%**, with top-quartile programs reaching roughly **59%**; leading AI-support deployments (Intercom Fin, among others) report full end-to-end resolution rates in the **66–76%** range across large customer bases, with **80%+** considered best-in-class on well-scoped, high-structure intent mixes. AI-handled CSAT typically runs a real but narrow gap below pure human handling (roughly 4.1/5 vs. 4.3/5 on a 5-point scale) — and critically, **hybrid escalation** (exactly the tiered human-handoff model above) is what narrows that gap to near-parity, versus a much wider gap when a platform pushes toward full automation without a reliable escalation path. This is also the direct lesson of the most-cited cautionary case in the category (a widely-covered 2024 AI-support deployment that automated two-thirds of chats and cut resolution time sharply, then reversed toward guaranteeing an always-available human option after CSAT dropped on complex, emotional tickets): full automation without a trustworthy escalation path is a false economy, and this design is built from the outset to avoid that failure mode rather than discover it in production.

#### 7.4.7 Agent reuse — the platform thesis proven at its hardest test

The contact center introduces exactly **three new agents** — Triage & Escalation, Resolution, and Support Insight — and reuses everything else already defined in this document: the Voice Agent/CALL-E for outbound callbacks, the Nurture & Follow-up Agent for post-resolution CSAT capture and reopen handling, the Forecasting & Insight Agent's renewal-risk scoring (now fed by support signal in addition to usage signal), and the Control Panel's governance and audit pattern applied unchanged to every triage and resolution decision. This is the sharpest available proof of the "agentic workspace" thesis (§2.2): not just reusing agents across departments, but reusing them across the **inbound and outbound halves of the same customer relationship** — closing a loop (a support pattern directly informing whether a renewal-risk save call happens) that a stitched-together stack of a separate CRM and a separate helpdesk structurally cannot close.

---

## 8. Technical Architecture

### 8.1 Architecture principles

- **Framework-agnostic agent core, AWS-native production runtime.** Strands Agents SDK is the agent-authoring layer (open source, code-first, tool-loop philosophy); Amazon Bedrock AgentCore is the production hosting layer (Runtime, Memory, Identity, Gateway, Observability, Policy). This separation matters: Strands agents can run anywhere (EC2, Lambda, Fargate, on-prem, another cloud), but AgentCore gives ImpulsoIQ session isolation (per-session microVMs), identity-scoped tool access, and built-in observability without owning that infrastructure — directly satisfying the AWS hackathon's "deploying with AgentCore strengthens your Technical Implementation score" guidance, and giving production ImpulsoIQ a real security/compliance story (access policies enforced at the platform layer, the same automated-reasoning technology behind IAM and S3).
- **Voice is a tool call, not a separate system.** CALL-E is integrated as an agent tool (via its MCP server and/or SDK) inside the Strands agent loop — the Voice agent doesn't "hand off" to a different app, it calls CALL-E the same way it would call an enrichment API, and the structured result flows back into the same agent reasoning loop and the same CRM write path as every other action.
- **Every agent action is an event.** The system is event-sourced at the action level (not just at the record level) so the Agent Control Panel, compliance audit trail, and cost dashboard are all views over the same underlying event log, not three separately maintained logging systems.
- **Multi-agent, not mono-agent.** Following AgentCore's Graph and Swarm orchestration patterns, ImpulsoIQ composes specialist agents (Research, Outreach, Voice, Nurture, Coordinator) rather than one monolithic agent with every tool — this bounds blast radius (a mis-scoped tool permission affects one specialist, not the whole system), keeps each agent's context window focused, and maps cleanly to the Control Panel's per-agent visibility model.

### 8.2 Reference architecture (AWS)

**Agent layer**
- **Strands Agents SDK** (Python) — defines the Coordinator, Research/Enrichment, Outreach, Voice, and Nurture agents, each with scoped tool access.
- **Amazon Bedrock AgentCore Runtime** — hosts each agent in an isolated, IAM-authenticated microVM session (15-min idle timeout / 8-hour max lifetime per session), enabling long-running campaign execution without ImpulsoIQ managing servers.
- **Amazon Bedrock** — foundation-model layer (Claude and/or Nova models via Bedrock's unified model access) powering reasoning, drafting, and classification across all agents.
- **AgentCore Memory** — short-term session context and long-term semantic memory per account/contact, so an agent "remembers" prior outreach history and call outcomes across sessions without re-fetching the full CRM history every run.
- **AgentCore Gateway** — single MCP endpoint exposing internal tools (CRM read/write, enrichment providers, CALL-E) to agents with per-tool, per-identity access control.
- **AgentCore Identity** — scoped credentials per agent/tool call, so (for example) the Voice agent can place a call but cannot independently modify billing records.
- **AgentCore Observability** — traces, token/tool-call metrics, and session telemetry, feeding the Control Panel's reasoning-trace view.

**Voice layer**
- **CALL-E** (MCP / SDK / API) — the Voice agent's calling tool, used for **every outbound call across the product**, including all contact-center outbound callbacks (§8.5). Call creation (`plan_call` / `run_call` / `POST /v1/calls`) is invoked with a natural-language task, recipient, and a strict JSON `result_schema` so every call returns typed, CRM-writable data (not free text the app has to re-parse). Terminal call results land via webhook into ImpulsoIQ's event bus. Idempotency keys prevent duplicate dials on retry. CALL-E's own governance layer (rate limits, blocklists, kill switches, redacted logs) is treated as a required baseline, layered under ImpulsoIQ's own consent/compliance rules (Section 11), not a replacement for them.
- **Amazon Connect** *(new in v4)* — the **inbound** telephony and omnichannel routing backbone for the contact center (§8.5); deliberately a separate system from CALL-E, not a competing choice for the same job.

**Application & data layer**
- **Amazon API Gateway + AWS Lambda / Fargate** — application backend and internal APIs.
- **Amazon Aurora (PostgreSQL-compatible)** — system-of-record relational data (contacts, accounts, deals, users, permissions).
- **Amazon DynamoDB** — high-throughput event/activity log (agent action events, call events) and session state.
- **Amazon OpenSearch Service** — full-text and semantic search across contacts, notes, transcripts, and agent logs.
- **Amazon S3** — object storage for call transcripts, exported reports, and attachments; lifecycle-policy archival for compliance retention.
- **Amazon EventBridge + Step Functions** — event routing and durable multi-step workflow orchestration for cross-agent campaigns (e.g., "enrich → draft → send → wait for reply → escalate to Voice agent if no reply after 5 days").
- **Amazon SES / Amazon SNS** — outbound email and SMS delivery channels (alongside CALL-E for voice).
- **Amazon Cognito** — authentication, SSO/SAML for enterprise tier, role-based access control.
- **Amazon CloudFront** — CDN for the frontend application.
- **Amazon QuickSight** (or embedded analytics layer) — dashboards and reporting.
- **AWS KMS + AWS CloudTrail** — encryption key management and full infrastructure-level audit trail, complementing the application-level agent-action audit trail described above.

**Frontend**
- React-based web application; role-based dashboards; the Agent Control Panel as a dedicated, real-time (WebSocket/EventBridge-pushed) surface rather than a polled admin page.

### 8.3 Multi-agent orchestration pattern

The Coordinator agent uses a **Graph pattern** for deterministic, auditable campaign workflows (e.g., a fixed enrichment → sequence → escalation pipeline) and a **Swarm pattern** for open-ended research tasks where multiple specialist agents collaborate on an ambiguous goal (e.g., "find and qualify companies that look like our best current customers") — matching orchestration strategy to workload predictability, per AWS's own guidance on Strands multi-agent design. Every orchestration decision (which pattern, which agents, in what order) is itself logged as an event, so the Control Panel can show not just *what* an agent did but *why the system chose that plan*.

### 8.4 Security & governance architecture

- Per-agent, per-tool scoped credentials (AgentCore Identity) — least-privilege by default; no agent has standing access to any tool it isn't actively using in that session.
- Approval-gate checkpoints (Section 7.3) enforced at the orchestration layer, not just the UI — an agent literally cannot execute a gated action without a recorded human approval event.
- Full event-sourced audit trail (every agent action, every call, every message) retained per the compliance schedule in Section 11.
- Kill switches at three levels: single agent run, single campaign, and account-wide (emergency stop for all outbound activity, including in-flight calls).

### 8.5 Inbound contact center: why Amazon Connect, not CALL-E, and why that's not two parallel systems

CALL-E remains the platform for every outbound call in the product, full stop. Inbound contact-center telephony is a different problem — queueing, skill-based routing, an agent workspace with live presence, and native omnichannel digital-channel handling unified with voice — none of which CALL-E is built for and none of which should be hand-rolled when a purpose-built AWS-native service already does it well. **Amazon Connect** is the inbound telephony and omnichannel routing backbone: usage-based pricing (no per-agent licensing, consistent with this product's cost discipline elsewhere), and its 2026 AI-first feature set includes **Contact Lens** (built-in call/chat transcription, sentiment analysis, trend detection) and **Connect Customer AI agents**, which natively support **MCP** — the same tool-integration standard ImpulsoIQ's own AgentCore Gateway already speaks.

**A deliberate architectural choice, stated explicitly:** ImpulsoIQ does not adopt Amazon Q in Connect or Connect's own native AI agents as the reasoning layer for support decisions. Both are genuinely capable, but routing decision-making through them would mean support conversations are reasoned about by a system the Agent Control Panel can't natively trace, evaluate, or govern through the same Cedar policy layer as every other agent in this product. Instead, **Connect provides telephony/routing/workspace infrastructure and Contact Lens's analytics as a data source**; ImpulsoIQ's own Triage & Escalation and Resolution agents (introduced in §7.4, built via Strands/AgentCore exactly like every other agent in this document) remain the reasoning layer, invoked from within Connect's contact flows via Lambda. Every support decision is logged, evaluated, and governed identically to a sales decision — one agent fleet, one Control Panel, one audit trail, regardless of which AWS service is moving the bits.

---

## 9. Data Model Overview

**Core entities:** `Account`, `Contact`, `Deal/Opportunity`, `Activity` (superset covering email, SMS, call, note, meeting, task — human- and agent-authored, structurally identical), `AgentRun` (a single agent execution: goal, plan, steps, tool calls, cost, outcome), `Campaign` (a goal + target list + playbook + schedule), `CallResult` (structured, schema-typed result from a CALL-E call, linked 1:1 to an `Activity`), `EnrichmentRecord` (source, confidence, timestamp, decay/refresh policy), `ConsentRecord` (per contact, per channel — email/SMS/voice — capturing opt-in/opt-out state and legal basis, referenced by every outbound agent action before execution), `User`/`Role`/`Permission`, `AuditEvent` (the event-sourced backbone underlying the Control Panel, cost dashboard, and compliance export).

The `ConsentRecord` entity is deliberately elevated to a first-class, always-checked entity (not a flag on `Contact`) because voice and SMS carry materially stricter, jurisdiction-specific consent requirements than email (Section 11), and the system must be able to prove, per channel and per contact, why an outbound action was legally permitted at the moment it was taken.

**Contact center entities (new in v4):** `Conversation` (the anchor entity — one customer, one thread, spanning every channel it's touched, not a separate record per channel), `Message` (per-channel content within a conversation, including voice transcripts), `Ticket` (tier, queue, assigned rep, SLA target), `Queue`/`SLAPolicy` (routing and response-time targets), `KnowledgeArticle` (versioned, embedded for grounded retrieval), `AgentStatus` (rep presence/capacity), `Macro` (canned-response library). `Conversation`, not `Ticket`, is the anchor deliberately: a customer who emails Monday and calls Wednesday about the same issue is one `Conversation`, not two disconnected tickets — the concrete schema-level expression of the "one customer, one history" narrative in §7.4.1.

---

## 10. Functional Requirements

**FR-1** Users can define a goal in natural language or select a saved playbook, targeting a list, segment, or trigger condition.
**FR-2** The system must ask clarifying questions before executing an ambiguous or underspecified goal (missing recipient detail, missing success criteria, missing timing constraints).
**FR-3** Agents must enrich a contact/account record from at least three independent data sources with source attribution and confidence scoring per field.
**FR-4** Agents must draft multi-channel outreach (email, SMS) matching a configurable brand voice/tone profile, and allow pre-send human review at a user-configurable checkpoint frequency (every send / first N sends / exceptions only).
**FR-5** The Voice agent must be able to place outbound calls with a defined goal and a structured result schema, and must return the call outcome to the CRM within a defined SLA (target: under 60 seconds after call completion).
**FR-6** The Voice agent must correctly detect and handle voicemail, hold, transfer, and interruption scenarios without requiring human intervention for the common case.
**FR-7** Any agent must be able to escalate to a human-in-the-loop queue when it encounters ambiguity, an out-of-script question, negative sentiment, or an explicit opt-out/removal request.
**FR-8** Every agent action (message sent, call placed, record modified, enrichment performed) must generate an immutable audit event visible in the Control Panel within 5 seconds of occurrence.
**FR-9** Users must be able to pause, resume, or kill any individual agent run, any campaign, or all outbound activity account-wide, with the action taking effect immediately (including terminating in-progress calls where technically feasible).
**FR-10** The system must check and enforce channel-specific consent status (`ConsentRecord`) before every outbound email, SMS, or call, and must block the action and log the block if consent is missing or revoked.
**FR-11** Users must be able to configure approval gates (mandatory human sign-off before execution) per campaign, per contact segment, or per action type.
**FR-12** The system must provide role-based dashboards showing pipeline, activity, agent performance, and channel-efficacy (conversion by email vs. SMS vs. voice) metrics.
**FR-13** The system must support deduplication, merge, and data-hygiene workflows, agent-assisted where possible (e.g., agent flags likely duplicates for human confirmation rather than auto-merging).
**FR-14** The system must expose an API and MCP interface so technical buyers (per the Clay-mindshare lesson in Section 4.2) can extend or integrate ImpulsoIQ agents into their own tooling.
**FR-15** The system must support saved, reusable playbooks (templated goals + guardrails) that can be assigned to new campaigns or triggers without redefinition.
**FR-16** *(new in v4)* Every inbound customer contact, regardless of channel, must be classified into one of four escalation tiers on arrival, using both message content and existing account context (deal history, renewal-risk score, prior ticket pattern).
**FR-17** *(new in v4)* The system must never allow an auto-resolved (Tier 0) response to execute a financial or contractual action (refund, cancellation, billing change) — this must be enforced as a policy-layer rule, not left to agent judgment.
**FR-18** *(new in v4)* Every agent-generated resolution or draft reply must cite the knowledge-base source(s) it is grounded in; if no sufficiently relevant, current source exists, the system must downgrade to human escalation rather than generate an ungrounded response.
**FR-19** *(new in v4)* A customer's conversation must unify across every channel they use to contact the business into a single thread, not a separate record per channel.
**FR-20** *(new in v4)* Support resolution outcomes and sentiment trends must feed into the same renewal-risk scoring used by the Customer Success workflow (Section 8.5/Persona 6), not remain siloed within the support function.
**FR-21** *(new in v4)* A tenant must be able to deploy an embeddable chat widget on their own external domain that connects to the same `Conversation`/agent pipeline as every other support channel — requiring a public, tenant-scoped widget credential distinct from internal authentication, CORS support, and abuse/rate-limit protection appropriate to a publicly-reachable endpoint.

---

## 11. Non-Functional Requirements

**Performance:** P95 UI response time under 300ms for standard CRM operations; agent action-to-Control-Panel-visibility latency under 5 seconds; call-result-to-CRM-write latency under 60 seconds.
**Scalability:** Support concurrent multi-tenant agent execution scaling horizontally via AgentCore Runtime session isolation; target initial capacity of 10,000+ concurrent agent sessions platform-wide without redesign.
**Availability:** 99.9% uptime target for core CRM/application layer at GA; graceful degradation for the agent layer (if an external dependency — an enrichment provider or CALL-E — is unavailable, the agent must fail safely, log the failure, and notify rather than silently stall or retry indefinitely).
**Security:** Least-privilege, per-agent scoped credentials (Section 8.4); encryption at rest and in transit; SOC 2 Type II readiness as a Year 1 production milestone; role-based access control; redacted logging for sensitive fields (matching CALL-E's own baseline of not logging phone numbers, transcripts, or PII in system telemetry beyond what's needed for the audit trail itself).
**Accessibility:** WCAG 2.1 AA compliance across the web application, including the Control Panel (per the product's own accessibility skill/standards — non-negotiable for an "enterprise-grade" product claim).
**Auditability:** Every agent action retained as an immutable, exportable event for a configurable retention period (default 7 years for compliance-sensitive industries, configurable down for lighter-touch segments).
**Reliability of voice channel:** Call connect-rate, voicemail-detection accuracy, and structured-result-schema-validation-pass-rate tracked as explicit SLOs, not just "calls placed" volume metrics — because a call that returns a malformed or low-confidence structured result is a data-quality failure even if the call itself succeeded technically.
**Internationalization:** UI and agent-drafted content must support the language/region set CALL-E currently supports (English, Hindi, Arabic, Vietnamese, German, Japanese, French, Spanish, Portuguese) as calling expands beyond English-only markets, even if the initial GA UI ships English-first.

---

## 12. Compliance Framework

Compliance is treated as a design constraint threaded through the data model (`ConsentRecord`), the architecture (per-action audit events, kill switches), and the functional requirements (FR-10, FR-11) — not a bolt-on legal review at the end.

| Regulation | Scope | ImpulsoIQ mechanism |
|---|---|---|
| **CAN-SPAM** (US email) | Commercial email requirements: accurate headers, opt-out mechanism, honoring opt-outs promptly | Agent-drafted email templates enforce required footer/opt-out elements by default; `ConsentRecord` opt-out state checked pre-send |
| **TCPA** (US telephony/SMS) | Consent requirements for autodialed/prerecorded calls and texts; time-of-day calling restrictions; Do-Not-Call Registry | Voice and SMS agent actions require an affirmative `ConsentRecord` for that channel before execution; calling-window enforcement (no calls outside permitted local hours) built into the Voice agent's scheduling logic; DNC-registry screening before first outbound call to a new number |
| **GDPR** (EU/UK) | Lawful basis for processing, data subject rights (access, erasure, portability), data minimization | `ConsentRecord` captures legal basis per contact/channel; data-subject request workflows (export/delete a contact and all associated agent history) as a supported operation, not a manual engineering request |
| **CCPA/CPRA** (California) | Consumer rights to know, delete, and opt out of sale/sharing of personal information | Equivalent data-subject request tooling to GDPR path; no sale/sharing of enriched contact data to third parties by default |
| **CASL** (Canada) | Express/implied consent for commercial electronic messages, stricter than CAN-SPAM | Consent capture defaults to the stricter CASL standard for any contact with a Canadian number/domain, rather than running two separate compliance logics |
| **Call recording / two-party consent laws** (varies by US state and country) | Some jurisdictions require all-party consent to record a call | Voice agent's opening disclosure and recording-consent behavior configurable per jurisdiction, defaulting to the stricter standard when the recipient's jurisdiction is ambiguous |

**Compliance-by-design principle:** the Voice and Outreach agents check `ConsentRecord` as a hard gate inside the tool-call path (not as a separate compliance review step a human might skip under deadline pressure) — an agent literally cannot construct a valid call or send request without a passing consent check, which is enforced at the AgentCore Identity/tool-permission layer described in Section 8.4.

---

## 13. Monetization & Pricing

Given active market skepticism toward "AI SDR" tools (Section 14) and the genuine COGS attached to voice/inference usage (Section 5.1), pricing is structured to (a) prove value before asking for payment, (b) tie price growth to demonstrated usage/value rather than seat count alone, and (c) avoid the "credit complexity" criticism leveled at Apollo's model (Section 4.1) by keeping the usage-based component simple and predictable.

| Tier | Target persona | Price shape | Includes |
|---|---|---|---|
| **Free** | Solo founder, evaluator | $0, no credit card | 1 seat, core CRM, limited monthly agent runs (research + draft + send), no voice calling — full end-to-end taste of the agent loop on email/SMS |
| **Starter** | Small sales team, SDR/BDR | Per-seat + included agent-run allotment | Full sequencing, enrichment, Control Panel, a starter voice-call allotment (e.g., 100 calls/mo included) with pay-as-you-go call packs beyond that |
| **Growth** (primary target tier) | Mid-market RevOps team | Per-seat + larger included allotments | Advanced playbooks, approval-gate configuration, team dashboards, higher voice-call allotment, API/MCP access, **Contact Center module available as an add-on (below)** |
| **Enterprise** | Sales-led, multi-department | Custom | SSO/SAML, custom data retention, dedicated compliance controls, workspace expansion (CS/recruiting/AR agent templates), **Contact Center included**, SLA, dedicated support |

Usage-based add-ons (call-minute packs, enrichment-record packs, additional concurrent-agent capacity) apply across all paid tiers, priced to preserve target gross margin (Section 5.1) even at heavy voice usage.

### 13.1 Contact Center pricing (new in v4)

The Contact Center (Section 7.4) has a materially different cost shape than the rest of the product — Amazon Connect's usage-based channel fees (per-minute voice, per-message chat, per-email, plus Contact Lens analytics) are a real, metered infrastructure cost on top of the LLM inference cost every other feature already carries, not a cost that disappears once the software is built. Per-tenant unit economics, at current published Connect rates: roughly **$0.03–0.04 per voice minute** (channel + Contact Lens + telco pass-through) and **~$0.01 per chat message**, against which our own Triage & Escalation and Resolution agent inference (Nova 2 Lite, medium thinking) adds under a cent per contact — meaning **Connect's channel usage, not our own AI, is the cost driver this tier's pricing has to track.** Given that, the Contact Center is priced as its own metered module, not folded silently into a flat per-seat number that could bleed margin as conversation volume grows independent of headcount:

| Element | Price shape | Rationale |
|---|---|---|
| **Base module fee** | Flat monthly fee, tier-gated (included at Enterprise, paid add-on at Growth, unavailable below Growth) | Covers the fixed cost of the module being active (phone number rental, base infrastructure) regardless of volume |
| **Per-conversation resolution fee** | Metered per conversation, tiered by resolution depth (Tier 0 auto-resolve priced lowest; Tier 1 draft-assist priced mid; Tiers 2–3 — human-handled, agent-assisted only — priced lowest of all, since the product did the least metered work) | Prices the actual COGS driver (Connect channel usage + inference) directly, rather than a flat per-seat number that doesn't track volume; mirrors how the rest of the product already prices call-minutes and enrichment credits as usage, not seats |
| **Embedded website widget** *(new)* | **Included at no additional fee**, metered identically to any other channel | A conversation originating from a tenant's own embedded chat widget on `their-domain.com` is, architecturally, just another instance of the chat channel already covered by the per-conversation fee (Section 7.4.3/8's channel-agnostic design) — pricing it separately would be inconsistent with "channel shouldn't change the price of a conversation," and adds no new COGS beyond what any chat conversation already costs |
| **Knowledge-base storage/authoring** | Included | Non-metered — authoring and versioning is a flat feature, not a usage cost |

**Why not flat/unlimited for the Contact Center:** an unlimited-conversation flat fee is the single fastest way to violate the cost-consciousness this section is built around — a support-heavy tenant's Connect bill scales directly with ticket volume regardless of what we charge them, so a flat price either overcharges a light-usage tenant or silently loses margin on a heavy one the moment their volume grows past whatever assumption set the flat price. Metering the actual cost driver (conversations, weighted by how much agent work each tier required) is what keeps this tier's margin predictable as tenants scale, consistent with the target gross margin band in Section 5.1.

**Governance tie-in:** all Contact Center usage — Connect channel consumption and agent inference alike — is checked against the same synchronous per-tenant metering/budget pipeline (Section 8, Implementation Plan Phase 3C/9) as every other metered capability in the product, so a volume spike (a viral support issue, a widget suddenly getting heavy traffic on a tenant's site) is visible on the cost dashboard and bounded by a configured ceiling before it becomes a bill surprise — not reported after the fact.

---

## 14. Risks & Mitigations

Flagged per Blessyn's own guidance as requiring particular rigor, given active market skepticism toward AI SDR tooling.

| Risk | Why it matters | Mitigation |
|---|---|---|
| **"AI SDR fatigue"** — buyers have been burned by generic, spam-flagged AI outreach tools and are skeptical by default | Directly threatens conversion and brand trust; the biggest go-to-market headwind in the category | Lead every GTM touchpoint with the Agent Control Panel, not the automation claim — sell *inspectable, controllable* automation, not "set it and forget it" volume; free tier lets skeptical buyers verify quality themselves before paying |
| **Voice-calling compliance/perception risk** — autonomous outbound calling can be perceived as robocalling even when legally compliant | Regulatory exposure (TCPA etc.) plus reputational risk if agents are perceived as spammy or deceptive | Hard consent gating (Section 12) at the tool-call level, not policy-level; mandatory agent self-disclosure as an AI caller where required/appropriate; conservative default calling windows; kill-switch and rate-limit governance inherited from and layered on top of CALL-E's own safety controls |
| **Third-party dependency risk** — CALL-E is itself an early-stage platform (SDK/API explicitly labeled "Phase 1 beta") | A core differentiator depends on a young external platform's uptime, API stability, and feature completeness | Abstract voice-calling behind ImpulsoIQ's own internal Voice-agent interface so the underlying provider is swappable; monitor CALL-E's roadmap closely (batch calling, scheduled calls, and webhook management are explicitly still outside Phase 1 beta scope as of this writing) and design fallback behavior (e.g., degrade to SMS/email follow-up) if a call cannot be placed |
| **Data quality/decay** — enrichment data goes stale, a problem every competitor (notably Apollo) also struggles with | Stale data undermines both agent decision quality and user trust | Automatic re-enrichment triggers on a decay policy per field type; confidence scoring surfaced to users and to agents themselves (an agent should treat a 90-day-old title as lower-confidence than a same-week signal) |
| **AI hallucination / incorrect agent action** — an agent drafts something inaccurate or a Voice agent mishandles a live conversation | Direct brand and revenue risk; the single biggest trust barrier to autonomous execution | Escalation-on-ambiguity as a hard architectural requirement (FR-7), not a soft guideline; approval gates configurable to "every action" for risk-averse teams; full auditability (FR-8) so any incident is immediately traceable and correctable |
| **Competitive response** — incumbents (Salesforce Agentforce, HubSpot Breeze) are actively adding agent features; Apollo/Clay could add voice | Category leaders have far greater distribution and could close the voice-and-transparency gap | Compound the two structural advantages that are hardest to copy quickly: (1) a unified data model across record + sequence + call from day one, vs. retrofitting voice onto a database-era architecture, and (2) the Control Panel as a genuine product surface, not a feature line item |
| **Regulatory change** (evolving telephony/AI-disclosure law across jurisdictions) | Multi-jurisdiction voice calling touches a fast-moving regulatory area | Compliance framework (Section 12) built to the strictest applicable standard by default per jurisdiction and designed to be updated centrally (consent-gate logic, not scattered checks) as law changes |
| **Margin compression from usage costs** — LLM inference and per-minute calling costs are real COGS, unlike classic SaaS | Could undermine unit economics (Section 5) if usage-based pricing doesn't track actual cost | Usage-based add-on pricing modeled directly against COGS (Section 13); agent efficiency (avoid redundant enrichment/calls) treated as a cost-control product requirement, not just a UX nicety |
| **Hackathon-driven scope pressure** — temptation to over-scope for demo impressiveness | Could compromise production-quality engineering discipline for a flashy 5-minute demo | MVP scope explicitly separated from full PRD scope (Section 16); demo built to show the real, working agent loop end-to-end rather than a wider but shallower feature surface |
| **"Full automation" trap in support** *(new in v4)* — pushing auto-resolution rate as the primary metric, at the cost of a reliable human-escalation path | The most-cited cautionary case in the AI-customer-service category (a 2024 deployment that automated two-thirds of chats, then reversed toward guaranteeing human availability after CSAT dropped on complex tickets) shows this is a real, observed failure mode, not a hypothetical | The four-tier escalation model (Section 7.4.4) and the grounded-response confidence gate (Section 7.4.5) are architected so "route to human" is the default failure mode, not an edge case; resolution-rate targets (Section 7.4.6) are explicitly paired with CSAT and escalation-path reliability, never optimized in isolation |
| **Mis-tiered support escalation** *(new in v4)* — a Tier-3-appropriate conversation (refund, legal mention, upset customer) incorrectly classified as Tier 0/1 | The single most direct customer-facing failure mode in the whole product — worse than a missed sales email, since it can mean an agent responding to something it should never have touched | Risk/sentiment is weighted independently of complexity/confidence in the triage classification (Section 7.4.4), so a simple-sounding but high-risk message (e.g., a calm-toned refund request) still escalates; Tier-0 action surface is hard-gated at the policy layer (FR-17) so even a mis-tiered conversation cannot trigger a financial/contractual action; triage accuracy is continuously evaluated (AgentCore Evaluations) against human-corrected tiers |
| **Two-telephony-system complexity** *(new in v4)* — running Amazon Connect (inbound) alongside CALL-E (outbound) risks becoming two disconnected voice stacks rather than one coherent capability | Could undermine the "one agent fleet, one Control Panel" trust story if support-side voice decisions aren't visible the same way sales-side calls are | Explicit architectural rule (Section 8.5): Connect provides telephony/transport only; ImpulsoIQ's own Bedrock/AgentCore agents remain the sole reasoning layer for both inbound and outbound voice decisions, logged identically in the same Control Panel and Evaluations pipeline regardless of which AWS service moved the call |

---

## 15. Success Metrics & KPIs

**Activation & engagement**
- Time to first successful agent run (target: under 10 minutes from signup)
- % of new signups who complete at least one full agent loop (goal → action → outcome) in week 1
- Weekly active agent runs per paying account

**Trust & quality**
- % of agent-drafted outreach sent unedited vs. edited vs. discarded
- % of agent runs inspected via Control Panel per user per week (target: meaningfully declining over a user's first 90 days as trust builds — a *healthy* downward trend, tracked explicitly rather than assumed)
- Escalation rate (% of agent runs requiring human handoff) and escalation resolution time

**Voice-channel specific**
- Call connect rate, call-to-qualified-outcome rate, voicemail-detection accuracy, structured-result schema-validation pass rate
- Calls blocked by consent gate (tracked as a compliance-health signal, not a failure metric)

**Business/GTM**
- Free-to-paid conversion rate; CAC by channel; LTV:CAC ratio; NRR; CAC payback period (all benchmarked against Section 5.1 targets)
- Workspace cross-sell rate: % of accounts activating a second department's agent templates within 12 months of initial signup (the key validation metric for the "agentic workspace" thesis in Section 2.2)

**Hackathon-specific (dual submission)**
- Agents for Humans: working AgentCore deployment, live demo availability, architecture diagram completeness, clarity of "problem / who it's for / why it matters" pitch
- CALL-E: a merged or reviewed pull request to the `awesome-phone-call-agents` repo, a clear, non-generic demonstration of a real business use case, and genuine runtime use of the CALL-E SDK/API/MCP (not just a reference)

**Contact center specific (new in v4)**
- End-to-end resolution rate, tier-0/1 deflection rate, and CSAT-by-tier, tracked against the industry benchmarks in Section 7.4.6 (66–76% resolution as a strong target, 4.1+/5 AI-handled CSAT with hybrid escalation narrowing the gap toward human-handled CSAT)
- Confidence-gate rejection rate (a *healthy* signal, not a failure metric — measures the system correctly choosing "route to human" over guessing) and its trend as the knowledge base matures
- Triage tier-classification accuracy against human-corrected tiers, with particular weight on false-negatives at Tier 3 (a Tier-3-appropriate conversation incorrectly under-classified is the single highest-severity quality failure in this feature set)
- % of accounts where a support signal directly informed a renewal-risk score change (the concrete validation metric for the inbound/outbound loop-closing claim in Section 7.4.7)

---

## 16. Roadmap: Hackathon MVP → Production

*Note: the phase numbering below (Phase 0–5) is this PRD's product-milestone framing. The companion Implementation Plan (`impulsoiq-implementation-plan-v4-phased.md`) sequences the same work at finer granularity as nine dependency-gated build phases (Phases 1–9); this roadmap's Phase 3 "Workspace expansion" corresponds to the Implementation Plan's Phase 5, and this roadmap's new Phase 5 below corresponds to the Implementation Plan's Phases 7–9.

### Phase 0 — Hackathon MVP (6-week build window, target: both Sep 14, 2026 deadlines)
- Single vertical wedge: SDR/AE lead-qualification-and-follow-up workflow only (Personas 1–3).
- Agents: Coordinator, Research/Enrichment (single strong data source, not full waterfall), Outreach (email only, SMS optional), Voice (CALL-E-integrated, qualification + meeting-confirmation calls only).
- Agent Control Panel: live action log + pause/kill, minimal approval-gate config.
- Architecture: Strands Agents SDK agents deployed on Bedrock AgentCore Runtime; CALL-E integrated via MCP; core CRM data model on Aurora; basic event log on DynamoDB.
- Deliverables: public MIT/Apache-licensed repo with README and setup instructions, architecture diagram, ≤5-minute demo video (AWS) / ~3-minute demo video (CALL-E), live demo link, AWS Builder ID, PR to `awesome-phone-call-agents`, CALL-E feedback survey submission.

### Phase 1 — Private beta / production hardening (Months 1–3 post-hackathon)
- Full multi-source enrichment waterfall; SMS channel; approval-gate configuration expanded; SOC 2 Type II readiness work begins; consent/compliance framework (Section 12) fully implemented, not just scaffolded.

### Phase 2 — GA launch (Months 3–6)
- Free tier + Starter/Growth self-serve pricing live; free-to-paid PLG funnel instrumented; Control Panel cost-dashboard shipped; CS/renewal persona (Grace) templates shipped as the first workspace-expansion proof point.

### Phase 3 — Workspace expansion (Months 6–12)
- Recruiting, AR follow-up, and vendor-coordination agent templates (Personas 7–9); Enterprise tier with SSO/SAML; API/MCP access GA for technical buyers; multi-language calling support expanded per CALL-E's regional coverage.

### Phase 4 — Scale (Year 2+)
- Enterprise land-and-expand motion; deeper industry-specific playbooks (real estate, financial services, healthcare services); international expansion aligned to CALL-E's supported-region roadmap; evaluate additional voice/telephony provider redundancy per the third-party dependency mitigation in Section 14.

### Phase 5 — Agentic Customer Service Contact Center (new in v4, Months 12–20, gated on Phase 3's agent roster having a proven production track record)
- **Foundation:** omnichannel conversation data model, Amazon Connect integration for inbound voice/chat transport, Triage & Escalation Agent, rep queue/conversation UI, knowledge-base authoring.
- **Resolution:** Resolution Agent with grounded, cited auto-resolution and draft-assist, the confidence-gate reliability guardrail (Section 7.4.5), the hard-gated Tier-0 action surface (FR-17), post-resolution CSAT capture reusing the Nurture Agent, inbound voice via Connect and outbound callbacks via the existing Voice Agent/CALL-E.
- **Insight & loop-closing:** Support Insight Agent (CSAT/SLA/backlog/deflection reporting, knowledge-base gap detection) and the new renewal-risk feedback loop (FR-20) connecting support signal to the existing CS save-call motion.
- Full agent-by-agent, feature-by-feature detail: Implementation Plan Phases 7, 8, and 9.

---

## 17. Hackathon Deliverable Mapping

### 17.1 Agents for Humans (AWS) — Professional Agents track

| Requirement | ImpulsoIQ mapping |
|---|---|
| Agent built with Strands Agents SDK, does real work end-to-end | Coordinator + specialist agent fleet (Section 8.3), executing the full research → draft → send → call → log loop |
| AgentCore deployment (strengthens Technical Implementation score) | Bedrock AgentCore Runtime, Memory, Gateway, Identity, Observability all used (Section 8.2) |
| Text description: what it does, who it's for, how it works | Sections 7.1–7.2 of this PRD, condensed for submission copy |
| Public repo, MIT/Apache license, README, setup instructions | Delivered per Phase 0 roadmap |
| Architecture diagram | Required next deliverable — AWS architecture diagram generated from Section 8.2 |
| Demo video (≤5 min): problem / who it's for / why it matters | Scripted around Personas 1–3 (Section 6.1) and the "reps spend under half their week selling" market pain point (Section 3.3) |
| AWS Builder ID, optional live demo link | Operational task, not a product-design task |
| Bonus: builder.aws.com build-story post | Recommended — write-up of the Strands + AgentCore + CALL-E integration story specifically, since that combination is itself a novel/creative angle |

### 17.2 CALL-E: Your Code Is Calling

| Requirement | ImpulsoIQ mapping |
|---|---|
| Uses CALL-E's SDK/API/MCP/CLI/SKILL to solve a real business problem | Voice agent (Section 7.3) — lead qualification and meeting-confirmation calling, a concrete, non-generic use case |
| PR to `awesome-phone-call-agents` repo, correct contribution area | Submit as an "Agent Skill" or "Workflow Plugin" depending on final packaging — decide during Phase 0 build |
| ~3-minute demo video | Focused specifically on the call itself: goal set → call planned → call placed → structured result written to CRM |
| CALL-E account email, optional functional demo link | Operational task |
| Feedback survey (Most Valuable Feedback prize eligibility) | Submit concrete integration feedback from the Phase 0 build (e.g., experience with batch/scheduled calling being outside Phase 1 beta scope, per Section 14) |

---

## 18. Appendix

### 18.1 Glossary
- **Agent** — an autonomous, goal-directed LLM-driven process with scoped tool access, distinct from a static automation/workflow rule.
- **Agent Control Panel** — ImpulsoIQ's dedicated transparency and governance surface for inspecting, approving, and controlling agent activity.
- **AgentCore** — Amazon Bedrock AgentCore, AWS's framework-agnostic managed infrastructure for hosting production agents.
- **CALL-E** — third-party goal-driven voice-calling agent platform, integrated as ImpulsoIQ's Voice agent's calling tool for all **outbound** calls.
- **Amazon Connect** *(new in v4)* — AWS's cloud contact-center service, used as the **inbound** telephony and omnichannel routing backbone for the contact center (Section 8.5); distinct from and complementary to CALL-E.
- **Conversation** *(new in v4)* — the anchor entity for the contact center's data model: one customer's full cross-channel history, not a per-channel record.
- **Tier 0–3** *(new in v4)* — the four-level escalation classification (auto-resolve, draft-for-review, human-required, hard-escalate) applied to every inbound support contact.
- **NRR** — Net Revenue Retention.
- **PLG** — Product-Led Growth.
- **Strands Agents SDK** — AWS's open-source, code-first agent-building framework.

### 18.2 Key sources consulted
Market sizing: Statista, Fortune Business Insights, Mordor Intelligence, Persistence Market Research, MarketsandMarkets, Research and Markets, The Business Research Company, Fortune Business Insights (call-center AI market). Unit economics: multiple independent 2026 B2B SaaS benchmark studies (Improvado, PM Toolkit, SaaSHero, GrowthSpree, Foundry CRO, Optifai). Competitive intelligence: Apollo.io, Clay, HubSpot, Salesforce public product/pricing documentation and independent 2026 vendor reviews; Intercom Fin, Zendesk AI, Freshdesk Freddy resolution-rate and CSAT benchmark data (Zendesk CX Trends 2026, Intercom Customer Service Trends 2026, McKinsey AI in Customer Service 2026, Gartner CX research, digitalapplied.com and Aissist.io 2026 industry syntheses). Technical architecture: AWS official Strands Agents SDK and Bedrock AgentCore documentation and engineering blog posts; CALL-E's public `call-e-integrations` repository and installation/API documentation; Amazon Connect, Contact Lens, and Connect Customer AI agents (MCP support) documentation and independent 2026 platform reviews. Hackathon requirements: official Devpost pages for *Agents for Humans* and *CALL-E: Your Code Is Calling* (accessed September 1, 2026).

### 18.3 Open questions for Blessyn
1. Final packaging decision for the CALL-E submission — Agent Skill vs. Workflow Plugin — affects PR structure and demo framing.
2. Confirm whether the hackathon MVP demo should feature one persona (AE follow-up) or two (SDR + AE) given the 5-minute video limit.
3. Confirm initial free-tier voice-call allotment (Section 13) — zero (email/SMS-only free tier) vs. a small trial allotment (e.g., 5 calls) to let free users experience the flagship differentiator before paywall.
4. Confirm target industries for the first vertical-specific playbooks in Phase 4 (Section 16).
5. *(new in v4)* Confirm whether the contact center (Phase 5 / Implementation Plan Phases 7–9) ships as an add-on to existing tiers or a separately-priced product line — affects both the pricing table (Section 13) and the GTM narrative (does support get sold as "included in the workspace" or as its own upsell motion).
6. *(new in v4)* Confirm the default Tier-0 auto-resolve posture for a brand-new tenant with an empty knowledge base — start conservative (most things route to Tier 1/2 until enough KB content exists) versus require a minimum KB size before Tier-0 is enabled at all.