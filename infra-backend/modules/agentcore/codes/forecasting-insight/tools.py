"""
Forecasting & Insight Agent — tool definitions (Phase 3A).

Waterfall:
  1. get_pipeline_data         — DSQL read via crm-read Lambda
  2. get_deal_activity_ages    — DSQL read for stall detection
  3. get_engagement_velocity   — DynamoDB GSI read (campaign events)
  4. compute_pipeline_forecast — DETERMINISTIC statistical calculation (NOT LLM)
  5. detect_deal_anomalies     — DETERMINISTIC anomaly detection (NOT LLM)
  6. write_forecast_report     — writes to reporting DynamoDB table

Rule: the LLM layer turns numeric output into NARRATIVE FLAGS.
      The LLM does NOT compute numbers or make predictions.
"""
import json
import os
import math
import boto3
from strands import tool

_lambda  = boto3.client("lambda",   region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_dynamo  = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _crm_read(operation: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_READ_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({"operation": operation, "payload": payload, "tenantId": tenant_id}).encode(),
    )
    return json.loads(resp["Payload"].read())


# ── Stage weights for weighted pipeline forecast ───────────────────────────────
STAGE_WEIGHTS = {
    "Prospecting":  0.05,
    "Qualified":    0.20,
    "Demo Booked":  0.40,
    "Proposal":     0.60,
    "Negotiating":  0.80,
    "Closed Won":   1.00,
}


@tool
def get_pipeline_data(tenant_id: str, lookback_days: int = 90) -> dict:
    """
    Read all open deals with stage, amount, and last activity date from DSQL.
    This is the raw data for both the forecast and the anomaly detector.
    Call this FIRST in the forecasting flow.
    """
    return _crm_read("get_pipeline_data", {"lookbackDays": lookback_days}, tenant_id)


@tool
def get_deal_activity_ages(tenant_id: str) -> dict:
    """
    Read days-in-current-stage and days-since-last-activity per deal.
    Used by detect_deal_anomalies to identify stalled deals.
    """
    return _crm_read("get_deal_activity_ages", {}, tenant_id)


@tool
def get_engagement_velocity(tenant_id: str, campaign_id: str) -> dict:
    """
    Read engagement events for a campaign from DynamoDB (gsi-campaign index).
    Returns counts of opens, clicks, replies in the last 30 days.
    """
    table = _dynamo.Table(os.environ.get("DYNAMODB_TABLE", ""))
    resp  = table.query(
        IndexName              = "gsi-campaign",
        KeyConditionExpression = "campaign_id = :cid",
        FilterExpression       = "tenant_id = :tid",
        ExpressionAttributeValues = {
            ":cid": campaign_id,
            ":tid": tenant_id,
        },
        Limit = 200,
    )
    items = resp.get("Items", [])
    opens   = sum(1 for i in items if i.get("eventType") == "Email Opened")
    clicks  = sum(1 for i in items if i.get("eventType") == "Email Clicked")
    replies = sum(1 for i in items if i.get("eventType") == "Email Replied")
    return {"campaignId": campaign_id, "opens": opens, "clicks": clicks, "replies": replies, "total": len(items)}


@tool
def compute_pipeline_forecast(pipeline_data: list, period_label: str) -> dict:
    """
    Compute weighted pipeline forecast using deterministic stage weightings.

    IMPORTANT: This is a deterministic mathematical calculation — NOT an LLM
    prediction. The LLM must call this tool and use its numeric output; it must
    NOT invent or estimate pipeline values.

    Stage weights: Prospecting=5%, Qualified=20%, Demo Booked=40%,
                   Proposal=60%, Negotiating=80%, Closed Won=100%.

    Returns {
      totalPipeline: float,      # unweighted sum of all open deals
      weightedForecast: float,   # probability-weighted expected revenue
      byStage: dict,             # breakdown by pipeline stage
      dealCount: int,
      period: str,
    }
    """
    total_pipeline  = 0.0
    weighted        = 0.0
    by_stage: dict  = {}

    for deal in pipeline_data:
        stage  = deal.get("stage", "Prospecting")
        amount = float(deal.get("amount", 0) or 0)
        weight = STAGE_WEIGHTS.get(stage, 0.05)

        total_pipeline += amount
        weighted       += amount * weight

        if stage not in by_stage:
            by_stage[stage] = {"count": 0, "totalAmount": 0.0, "weightedAmount": 0.0}
        by_stage[stage]["count"]          += 1
        by_stage[stage]["totalAmount"]    += amount
        by_stage[stage]["weightedAmount"] += amount * weight

    return {
        "totalPipeline":   round(total_pipeline, 2),
        "weightedForecast": round(weighted, 2),
        "byStage":         by_stage,
        "dealCount":       len(pipeline_data),
        "period":          period_label,
    }


@tool
def compute_team_activity_medians(deal_ages: list) -> dict:
    """
    Compute team-wide median days-in-stage and median days-since-activity.
    Used as the baseline for anomaly detection.
    DETERMINISTIC: sorted median, no LLM involvement.
    """
    in_stage_vals    = [float(d.get("days_in_stage", 0) or 0) for d in deal_ages]
    activity_vals    = [float(d.get("days_since_activity", 0) or 0) for d in deal_ages if d.get("days_since_activity") is not None]

    def median(vals: list) -> float:
        if not vals: return 0.0
        s = sorted(vals)
        n = len(s)
        return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0

    return {
        "medianDaysInStage":       round(median(in_stage_vals), 1),
        "medianDaysSinceActivity": round(median(activity_vals), 1),
    }


@tool
def detect_deal_anomalies(deal_ages: list, team_medians: dict, threshold_multiplier: float = 1.5) -> list:
    """
    Identify deals whose days-since-activity exceeds threshold_multiplier × team median.

    DETERMINISTIC: pure numeric comparison, no LLM guessing.
    Returns a list of risk flags with deal_id, deal_name, days_quiet, team_median,
    stage, and amount for the LLM to turn into narrative alerts.
    """
    median_quiet = team_medians.get("medianDaysSinceActivity", 5.0)
    threshold    = median_quiet * threshold_multiplier
    flags        = []

    for deal in deal_ages:
        days_quiet = float(deal.get("days_since_activity", 0) or 0)
        if days_quiet >= threshold:
            flags.append({
                "dealId":       deal.get("id"),
                "dealName":     deal.get("name"),
                "stage":        deal.get("stage"),
                "amount":       deal.get("amount"),
                "daysQuiet":    round(days_quiet, 1),
                "teamMedian":   round(median_quiet, 1),
                "xAboveMedian": round(days_quiet / max(median_quiet, 1), 2),
            })

    return sorted(flags, key=lambda x: x["daysQuiet"], reverse=True)


@tool
def write_forecast_report(
    tenant_id:     str,
    forecast:      dict,
    risk_flags:    list,
    narratives:    list,
    report_period: str,
) -> dict:
    """
    Write the complete forecast report to the reporting DynamoDB table.

    The reporting table is the ONLY place the dashboard reads forecasts from.
    It is kept separate from DSQL to isolate analytical reads from OLTP.

    narratives: list of human-readable strings the LLM generates from the
                numeric forecast + risk_flags. These are the dashboard display texts.
    """
    import datetime
    now   = datetime.datetime.utcnow().isoformat() + "Z"
    ttl   = int(datetime.datetime.utcnow().timestamp()) + 90 * 86_400  # 90-day TTL

    table = _dynamo.Table(os.environ.get("REPORTING_TABLE", ""))
    table.put_item(Item={
        "pk":            f"{tenant_id}#report#pipeline_forecast",
        "sk":            now,
        "tenant_id":     tenant_id,
        "report_type":   "pipeline_forecast",
        "generatedAt":   now,
        "period":        report_period,
        "forecast":      forecast,
        "riskFlags":     risk_flags,
        "narratives":    narratives,
        "ttl":           ttl,
    })

    # Also write a latest pointer (fixed SK) for fast dashboard queries
    table.put_item(Item={
        "pk":            f"{tenant_id}#report#pipeline_forecast",
        "sk":            "latest",
        "tenant_id":     tenant_id,
        "report_type":   "pipeline_forecast",
        "generatedAt":   now,
        "period":        report_period,
        "forecast":      forecast,
        "riskFlags":     risk_flags,
        "narratives":    narratives,
        "ttl":           ttl,
    })

    return {"ok": True, "generatedAt": now, "riskFlagCount": len(risk_flags)}


# ── Phase 9D: CS loop — support signal inputs to renewal-risk scoring ─────────

@tool
def get_support_signals_for_contact(tenant_id: str, contact_id: str) -> dict:
    """
    Phase 9D: Read support conversation history for a contact to inform
    renewal-risk scoring. This closes the loop between support data and
    the CS renewal/save motion (Phase 5E).

    Returns:
      { tierPattern: [int], csatTrend: [float], escalationCount: int,
        latestCsat: float|None, repeatedIssues: bool }

    Integration: the Forecasting & Insight Agent passes these signals to
    compute_renewal_risk_composite to produce a support-adjusted renewal risk score.

    Per v4 §9D: "A customer with repeated Tier-2/3 escalations and declining
    CSAT is exactly the renewal-risk profile 5E's save-call motion exists to catch."
    """
    result = _crm_read(
        "get_support_signals_for_contact",
        {"contactId": contact_id, "limit": 20},
        tenant_id,
    )
    tickets = result.get("result", []) or []

    if not tickets:
        return {
            "tierPattern":      [],
            "csatTrend":        [],
            "escalationCount":  0,
            "latestCsat":       None,
            "repeatedIssues":   False,
            "hasData":          False,
        }

    tier_pattern    = [int(t.get("tier", 1)) for t in tickets]
    csat_values     = [float(t["csat_score"]) for t in tickets if t.get("csat_score") is not None]
    escalation_count = sum(1 for t in tickets if t.get("tier", 1) >= 2)

    # Detect repeated issues: ≥2 tickets with similar queue/tags in 60 days
    queues = [t.get("queue_name", "") for t in tickets]
    repeated_issues = len(queues) > 1 and len(set(queues)) < len(queues) * 0.6

    return {
        "tierPattern":      tier_pattern,
        "csatTrend":        csat_values,
        "escalationCount":  escalation_count,
        "latestCsat":       csat_values[-1] if csat_values else None,
        "repeatedIssues":   repeated_issues,
        "hasData":          True,
        "ticketCount":      len(tickets),
    }


@tool
def compute_renewal_risk_composite(
    deal_data:        dict,
    support_signals:  dict,
    usage_signals:    dict,
) -> dict:
    """
    Phase 9D: Compute a renewal risk score that incorporates support data
    alongside deal age and usage signals.

    DETERMINISTIC — the same "Code Interpreter computes, LLM narrates" principle
    applied to renewal risk as to pipeline forecasting.

    Risk factors (each additive):
      - days to renewal < 60:             +0.2
      - deal stage = Negotiating:         +0.1
      - usage decline ≥ 30%:              +0.3
      - CSAT below 3.5:                   +0.2
      - Tier-2/3 escalation in last 30d:  +0.2
      - Repeated support issues:          +0.1

    Returns { riskScore: float, riskLevel: str, supportContribution: float }
    """
    risk = 0.0
    support_contribution = 0.0

    # Deal-based factors
    days_to_renewal = deal_data.get("daysToRenewal", 365)
    if days_to_renewal < 60:
        risk += 0.2

    stage = deal_data.get("stage", "")
    if stage in ("Negotiating", "Proposal"):
        risk += 0.1

    # Usage-based factors
    usage_decline = usage_signals.get("declinePercent", 0.0)
    if usage_decline >= 0.30:
        risk += 0.3
    elif usage_decline >= 0.15:
        risk += 0.15

    # Support-based factors (Phase 9D additions)
    if support_signals.get("hasData"):
        latest_csat = support_signals.get("latestCsat")
        if latest_csat and latest_csat < 3.5:
            risk += 0.2
            support_contribution += 0.2

        if support_signals.get("escalationCount", 0) >= 1:
            risk += 0.2
            support_contribution += 0.2

        if support_signals.get("repeatedIssues"):
            risk += 0.1
            support_contribution += 0.1

    # Normalize to 0-1
    risk  = min(round(risk, 2), 1.0)
    level = "high" if risk >= 0.6 else "medium" if risk >= 0.3 else "low"

    return {
        "riskScore":            risk,
        "riskLevel":            level,
        "supportContribution":  round(support_contribution, 2),
        "usageContribution":    round(min(usage_decline, 0.3), 2),
        "daysToRenewal":        days_to_renewal,
    }
