"""
Support Insight Agent — Phase 9A/B.

Synthesizes support health metrics into management-ready insight and
surfaces knowledge-base gaps as an actionable approval queue backlog.

EXACT architectural parallel to Forecasting & Insight (3A):
  compute_support_stats (Code Interpreter, deterministic math)
  detect_support_anomalies (deterministic benchmark comparison)
  LLM layer narrates the output — does not compute numbers

Phase 9B (KB gap detection) is output of the same synthesis run:
  find_kb_gaps → create_kb_gap_proposals → Control Panel approval queue
  This closes the loop on Phase 8's confidence gate: gaps that keep
  triggering the gate become visible as a prioritized "write this article"
  backlog rather than silently repeating.

Phase 9D (CS loop) is handled by the Forecasting & Insight Agent (3A/5E)
receiving support signals — no changes here.

Scheduled: weekly (Sundays 05:00 UTC, before forecasting at 07:00)
Model: Nova 2 Lite, medium thinking (v4 §5 default)
"""
import json
import os
import datetime
from strands import Agent
from .tools import (
    get_support_metrics,
    compute_support_stats,
    detect_support_anomalies,
    find_kb_gaps,
    create_kb_gap_proposals,
    write_support_insight_report,
)

MODEL = os.environ.get("SUPPORT_INSIGHT_MODEL", "us.amazon.nova-lite-v1:0")

SYSTEM_PROMPT = """
You are the ImpulsoIQ Support Insight Agent. You synthesize support operations
data into management-ready health reports and surface KB gaps as actionable tasks.

## Critical rule: CODE INTERPRETER COMPUTES, YOU NARRATE

compute_support_stats computes ALL the numbers. detect_support_anomalies flags
ALL the benchmarks. Your job is to turn those outputs into 3–5 plain-language
insights that a support manager can act on immediately.

Do NOT compute your own percentages, averages, or rates. Call the tools and use
their outputs.

## Execution flow

1. get_support_metrics(tenant_id, period_days=30)
2. compute_support_stats(raw_data from step 1)
3. detect_support_anomalies(stats from step 2)
4. find_kb_gaps(tenant_id)
5. Based on anomalies and gaps, write 3–5 plain-language narratives:
   - Be specific: "Tier-0 deflection rate is 32% — below the 40% target.
     The Billing queue has the lowest deflection, suggesting that billing
     questions need more KB articles."
   - NOT vague: "Support performance could be improved."
6. create_kb_gap_proposals(tenant_id, gaps from step 4)
7. write_support_insight_report(tenant_id, stats, anomalies, narratives, kb_gaps, period)

## Industry benchmarks (from v4 §9A — use as targets in narratives)

Deflection rate:    target 40%+, top-quartile 59%
Resolution rate:    target 66%+, best-in-class 80%+
CSAT (AI):          baseline 4.1/5; hybrid target 4.25/5
SLA breach rate:    target < 5%
First response:     target < 60 min

## Output format

{ "status": "complete", "period": "<period>",
  "deflectionRate": <float>, "csatAvg": <float|null>,
  "anomalyCount": <int>, "kbGapProposalsCreated": <int> }
""".strip()


def run(event: dict) -> dict:
    """
    Entry point invoked by EventBridge Scheduler (weekly) or direct call.
    Event: { tenantId, periodDays?, reportPeriod? }
    """
    tenant_id  = event.get("tenantId", "")
    period_days = int(event.get("periodDays", 30))

    if not tenant_id:
        return {"error": "tenantId required", "status": "failed"}

    now    = datetime.datetime.utcnow()
    period = event.get("reportPeriod", now.strftime("%Y-%m"))

    agent = Agent(
        model         = MODEL,
        system_prompt = SYSTEM_PROMPT,
        tools         = [
            get_support_metrics,
            compute_support_stats,
            detect_support_anomalies,
            find_kb_gaps,
            create_kb_gap_proposals,
            write_support_insight_report,
        ],
    )

    prompt = (
        f"Run the support insight analysis.\n"
        f"Tenant ID:   {tenant_id}\n"
        f"Period:      last {period_days} days ({period})\n"
        f"Today:       {now.strftime('%Y-%m-%d')}\n\n"
        f"Follow the execution flow exactly. Compute all numbers via tools."
    )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "period": period}
