"""
Signal Listening Agent — Phase 4C (new in v3).

Continuous, unprompted monitoring of public web/social signals to originate
brand-new candidate leads before any CRM record exists.

TWO-STAGE ARCHITECTURE (v3 §5.2 Model Tiering):
  Stage 1 — Nova Micro first-pass classifier (classifier.py)
    High volume, cheap, binary. Filters raw signals from RSS/Reddit/PR wires.
    Almost everything is filtered out here.
  Stage 2 — Nova 2 Lite synthesis (this agent + tools.py)
    Only promoted candidates from Stage 1 reach this stage.
    Full company resolution, executive mapping, email verification.
    Identical treatment to a manually-targeted record in Phase 2A.

DESIGN CONSTRAINTS (permanent, not roadmap gaps — v3 §Phase 4, 4C):
  1. Operates only on NAMED COMPANY mentions and public business signals.
  2. NEVER attempts to deanonymize an anonymous social-media poster's employer.
  3. Every originated candidate enters the Control Panel approval queue first.
     No originated contact enters the standard pipeline without human sign-off.
  4. Cannot run Stage 2 without Phase 3C metering budget confirmed in advance.
  5. Legal review required per tenant, per monitored source, before activation.
  6. Rate-limit-aware, staggered request pacing; immediate back-off on 429.

COST GOVERNANCE:
  Stage 1 budget: SIGNAL_DAILY_STAGE1_TOKENS (default: 500k Nova Micro tokens)
  Stage 2 budget: SIGNAL_DAILY_STAGE2_TOKENS (default: 100k Nova 2 Lite tokens)
  Both are environment variables, not agent-discretionary, per v3 spec.

ARM64 container.
"""
import json
import os
import datetime
import boto3
from strands import Agent
from impulsoiq_model import build_model
from .classifier import batch_classify
from .tools import (
    fetch_rss_signals,
    fetch_reddit_signals,
    check_signal_budget,
    check_source_legal_status,
    promote_to_research_pipeline,
    record_run_stats,
)

# Stage 2 uses Nova 2 Lite — same model as Research & Enrichment (v3 §5.2)
STAGE2_MODEL = os.environ.get("SIGNAL_STAGE2_MODEL", "global.amazon.nova-2-lite-v1:0")
REGION       = os.environ.get("AWS_REGION", "eu-west-2")

# ── Default source configurations ────────────────────────────────────────────
# These are suggestions — each tenant must have each source legally reviewed
# and explicitly approved before it's activated for their account.

DEFAULT_SOURCES = [
    {
        "key":   "job_board_sales_rss",
        "type":  "rss",
        "label": "Sales/RevOps job postings (Indeed RSS)",
        "url":   "https://www.indeed.com/rss?q=head+of+sales&l=&sort=date",
        "signalCategory": "hiring_signal",
    },
    {
        "key":   "pr_newswire_tech",
        "type":  "rss",
        "label": "PR Newswire technology releases",
        "url":   "https://www.prnewswire.com/rss/news-releases-list.rss",
        "signalCategory": "press_release",
    },
    {
        "key":   "reddit_sales",
        "type":  "reddit",
        "label": "r/sales discussion signals",
        "subreddit": "sales",
        "query":     "CRM pipeline outreach struggling problem",
        "signalCategory": "forum_pain_signal",
    },
]

SYSTEM_PROMPT = """
You are the ImpulsoIQ Signal Listening Agent. You originate brand-new candidate
leads from public signals — companies that haven't yet been added to the CRM.

## Your job (Stage 2 only — you only see pre-filtered, classified candidates)

Each candidate you receive has ALREADY passed Stage 1 classification (a cheap Nova
Micro binary filter). Your job is to:
1. Call check_signal_budget FIRST. If budget is exhausted, STOP immediately.
2. For each source: call check_source_legal_status. If not approved, SKIP that source.
3. Call fetch_rss_signals OR fetch_reddit_signals for each approved source.
4. For each result returned by the fetchers, evaluate whether it describes a named
   company with a genuine business pain — be conservative, not generous.
5. Call promote_to_research_pipeline for qualifying companies.
6. Call record_run_stats at the end of each run.

## Hard constraints — never deviate

- NEVER promote a signal where the company name is not explicitly stated in the text.
  Anonymous posters, anonymous companies, and "my company" without a name do NOT qualify.
- NEVER attempt to identify who wrote an anonymous post by examining their profile.
- ALWAYS check source legal status before fetching from any source.
  If check_source_legal_status returns approved=False, skip that source entirely.
- ALWAYS check budget before promoting any candidate to Stage 2.
- Every promoted candidate gets an approval queue entry — this is non-negotiable.
  No originated contact ever enters the outreach pipeline without human review.
- If you hit a rate limit (error contains "Rate limited"), stop fetching from that
  source for this run — do not retry.

## What a qualifying signal looks like

GOOD: "Acme Corp is hiring a VP of Sales Operations — they're building their RevOps stack from scratch"
GOOD: Press release: "Meridian Health announces expansion into European markets"
BAD:  "someone in my company keeps losing track of leads" (no company name)
BAD:  Inferring employer from a user's post history (design constraint, permanent)

## Output format

After record_run_stats, respond with:
{ "runComplete": true, "fetched": N, "promoted": N, "skipped": N }
""".strip()


def run(event: dict) -> dict:
    """
    Entry point invoked by EventBridge Scheduler (hourly) or direct Lambda invoke.

    Event: { tenantId, sources?: [...], dryRun?: bool }
    dryRun=True fetches and classifies but does NOT promote to the pipeline.
    """
    tenant_id = event.get("tenantId", "")
    if not tenant_id:
        return {"error": "tenantId required", "status": "failed"}

    sources  = event.get("sources", DEFAULT_SOURCES)
    dry_run  = event.get("dryRun", False)

    agent = Agent(
        model         = build_model(STAGE2_MODEL),
        system_prompt = SYSTEM_PROMPT + (
            "\n\nDRY RUN MODE: fetch and classify but call promote_to_research_pipeline "
            "with dryRun=True — do not write any records." if dry_run else ""
        ),
        tools = [
            fetch_rss_signals,
            fetch_reddit_signals,
            check_signal_budget,
            check_source_legal_status,
            promote_to_research_pipeline,
            record_run_stats,
        ],
    )

    now    = datetime.datetime.utcnow().isoformat() + "Z"
    prompt = (
        f"Run the signal listening sweep.\n"
        f"Tenant ID: {tenant_id}\n"
        f"Run at:    {now}\n"
        f"Sources:   {json.dumps([s['key'] for s in sources])}\n"
        f"Dry run:   {dry_run}\n\n"
        f"Check budget first. For each source that passes legal review, fetch signals, "
        f"identify qualifying companies, and promote them to the research pipeline."
    )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "runAt": now}
