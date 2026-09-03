"""
Forecasting & Insight Agent — Phase 3A.

Produces two outputs per scheduled run:
  1. Weighted pipeline forecast (numeric, deterministic)
  2. Risk flags for stalled deals (deterministic anomaly detection)
  3. Narrative summaries (LLM turn of numeric output into plain-language alerts)

IMPORTANT: The LLM does NOT compute numbers or predict probabilities.
All quantitative work is done by deterministic tool calls.
The LLM's job is to turn numbers into clear, actionable narratives.

Scheduled trigger: EventBridge Scheduler at 07:00 UTC daily.
ARM64 container; model: Claude Sonnet (configurable via FORECASTING_MODEL env var).
"""
import json
import os
import datetime
from strands import Agent
from .tools import (
    get_pipeline_data,
    get_deal_activity_ages,
    get_engagement_velocity,
    compute_pipeline_forecast,
    compute_team_activity_medians,
    detect_deal_anomalies,
    write_forecast_report,
    # Phase 9D: support signal inputs to renewal-risk scoring
    get_support_signals_for_contact,
    compute_renewal_risk_composite,
)

SYSTEM_PROMPT = """
You are the ImpulsoIQ Forecasting & Insight Agent. You synthesise pipeline data
into accurate, actionable forecasts and surface risk flags for sales managers.

## Critical rules

1. NUMBERS FROM TOOLS ONLY: You must call compute_pipeline_forecast and
   detect_deal_anomalies to get all numeric values. Never estimate, guess, or
   invent a pipeline figure. If a tool is not called, you have no number.

2. NARRATIVE IS YOUR JOB: Once you have numeric output from tools, your role is
   to write clear, specific, plain-language narratives a manager can act on.
   Examples:
   - "Weighted forecast for September: $847K against $1.4M unweighted pipeline."
   - "3 deals flagged as stalled: Acme Corp has been quiet 14 days (team median: 5)."
   - NOT: "Pipeline looks healthy." — too vague, no specifics.

3. ONE REPORT PER RUN: Always end with write_forecast_report. If you cannot
   complete the full analysis, write a partial report with what you have.

4. PER-TENANT SCOPE: Every tool call requires tenant_id. Never mix data from
   different tenants.

## Execution flow

1. get_pipeline_data(tenant_id, lookback_days=90)
2. get_deal_activity_ages(tenant_id)
3. compute_pipeline_forecast(pipeline_data=<result from 1>, period_label=<current YYYY-MM>)
4. compute_team_activity_medians(deal_ages=<result from 2>)
5. detect_deal_anomalies(deal_ages=<result from 2>, team_medians=<result from 4>)
6. Write 3–5 plain-language narrative strings based on the numeric outputs.
7. write_forecast_report(tenant_id, forecast=<3>, risk_flags=<5>, narratives=<6>, period=<YYYY-MM>)

## Output format

After write_forecast_report, respond with:
{
  "status": "complete",
  "period": "YYYY-MM",
  "weightedForecast": <number>,
  "riskFlagCount": <number>,
  "tenantId": "<tenant_id>"
}
""".strip()

MODEL = os.environ.get("FORECASTING_MODEL", "us.amazon.nova-lite-v1:0")


def run(event: dict) -> dict:
    """
    Entry point invoked by EventBridge Scheduler.

    Event: { tenantId, reportPeriod? }
    If tenantId = "__ALL__", run for all active tenants (admin batch run).
    For the hackathon demo, single-tenant runs are the primary path.
    """
    tenant_id = event.get("tenantId", "")
    if not tenant_id or tenant_id == "__ALL__":
        # Batch mode: iterate active tenants — deferred to Phase 4 analytics expansion
        return {"status": "skipped", "reason": "batch mode not yet implemented"}

    now    = datetime.datetime.utcnow()
    period = event.get("reportPeriod", now.strftime("%Y-%m"))

    agent  = Agent(
        model         = MODEL,
        system_prompt = SYSTEM_PROMPT,
        tools         = [
            get_pipeline_data,
            get_deal_activity_ages,
            get_engagement_velocity,
            compute_pipeline_forecast,
            compute_team_activity_medians,
            detect_deal_anomalies,
            write_forecast_report,
            # Phase 9D: support signals feed renewal-risk scoring
            get_support_signals_for_contact,
            compute_renewal_risk_composite,
        ],
    )

    prompt = (
        f"Run the full pipeline forecast and risk analysis.\n"
        f"Tenant ID:  {tenant_id}\n"
        f"Period:     {period}\n"
        f"Today:      {now.strftime('%Y-%m-%d')}\n\n"
        f"Follow the execution flow in your system prompt exactly."
    )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "period": period}
