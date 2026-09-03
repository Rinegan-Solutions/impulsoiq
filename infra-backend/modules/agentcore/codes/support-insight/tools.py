"""
Support Insight Agent — tool definitions (Phase 9A/B).

Identical architectural pattern to Forecasting & Insight (3A):
  Code Interpreter does the actual computation (deterministic math)
  LLM layer narrates the output into plain-language flags

Industry benchmarks from v4 §9A (used as targets, not day-one claims):
  Tier-1 deflection:  median 41%, top-quartile 59%
  Resolution rate:    66–76%, best-in-class 80%+
  AI CSAT:            4.1/5 (human: 4.3/5; hybrid narrows gap to ~0.05)
  Hybrid escalation:  narrows CSAT gap vs full automation by ~0.05 points
  SLA breach rate:    target < 5%
"""
import json
import os
import math
import datetime
import statistics
import boto3
from strands import tool

REGION  = os.environ.get("AWS_REGION", "eu-west-2")
_lambda = boto3.client("lambda", region_name=REGION)
_dynamo = boto3.resource("dynamodb", region_name=REGION)


def _crm_read(op: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_READ_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({"operation": op, "payload": payload, "tenantId": tenant_id}).encode(),
    )
    return json.loads(resp["Payload"].read())


def _crm_write(op: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_WRITE_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({
            "operation": op, "payload": payload, "tenantId": tenant_id,
            "actorType": "agent", "actorId": "support-insight-agent",
        }).encode(),
    )
    return json.loads(resp["Payload"].read())


# ── Industry benchmarks from v4 §9A ───────────────────────────────────────────

BENCHMARKS = {
    "deflection_rate":     {"median": 0.41, "top_quartile": 0.59, "target": 0.40},
    "resolution_rate":     {"median": 0.66, "best_in_class": 0.80, "target": 0.66},
    "csat_avg":            {"ai_baseline": 4.1, "human": 4.3, "hybrid_target": 4.25},
    "sla_breach_rate":     {"target_max": 0.05},
    "first_response_mins": {"target_max": 60},
}


@tool
def get_support_metrics(tenant_id: str, period_days: int = 30) -> dict:
    """
    Fetch raw support data for the analysis period via crm-read.
    Returns tickets, conversations, and tier distribution.

    Call this FIRST — it provides the raw data for compute_support_stats.
    """
    result = _crm_read(
        "get_support_metrics",
        {"periodDays": period_days},
        tenant_id,
    )
    return result.get("result", {}) or {}


@tool
def compute_support_stats(raw_data: dict) -> dict:
    """
    Code Interpreter: deterministic computation of all support health metrics.

    THE LLM DOES NOT COMPUTE THESE NUMBERS. Call this tool and use its output.
    The LLM's role is to narrate — not to calculate. (Same principle as Phase 3A)

    Metrics computed:
      deflection_rate      — Tier-0 auto-resolved / total tickets
      resolution_rate      — resolved conversations / total conversations
      csat_avg             — mean CSAT score (1.0–5.0)
      csat_by_tier         — CSAT broken down by triage tier
      sla_breach_rate      — breached tickets / total tickets
      first_response_secs  — average first-response time in seconds
      average_handle_secs  — average handle time (created → resolved)
      backlog_by_queue     — open ticket count per queue
      tier_distribution    — count of tickets per tier
    """
    tickets       = raw_data.get("tickets", [])
    conversations = raw_data.get("conversations", [])

    total_tickets = len(tickets)
    total_convs   = len(conversations)

    if total_tickets == 0:
        return {"insufficient_data": True, "message": "No tickets in period"}

    # Deflection rate: Tier-0 auto-resolved vs total
    tier0_resolved = sum(1 for t in tickets if t.get("tier") == 0 and t.get("resolved"))
    deflection_rate = tier0_resolved / total_tickets

    # Resolution rate
    resolved = sum(1 for c in conversations if c.get("status") == "resolved")
    resolution_rate = resolved / max(total_convs, 1)

    # CSAT
    csat_all = [c["csat_score"] for c in conversations if c.get("csat_score") is not None]
    csat_avg = round(statistics.mean(csat_all), 2) if csat_all else None

    # CSAT by tier
    tier_csat: dict[int, list[float]] = {}
    for t in tickets:
        tier = t.get("tier")
        csat = t.get("csat_score")
        if tier is not None and csat is not None:
            tier_csat.setdefault(tier, []).append(float(csat))
    csat_by_tier = {str(k): round(statistics.mean(v), 2) for k, v in tier_csat.items()}

    # SLA breach rate
    breached = sum(1 for t in tickets if t.get("sla_breached_at"))
    sla_breach_rate = breached / total_tickets

    # First-response time (seconds from conversation created_at → first_response_at)
    frts = []
    for c in conversations:
        if c.get("first_response_at") and c.get("created_at"):
            try:
                fr  = datetime.datetime.fromisoformat(c["first_response_at"].replace("Z", "+00:00"))
                cr  = datetime.datetime.fromisoformat(c["created_at"].replace("Z", "+00:00"))
                frts.append((fr - cr).total_seconds())
            except (ValueError, TypeError):
                pass
    first_response_secs = round(statistics.mean(frts)) if frts else None

    # Average handle time (created_at → resolved_at)
    handles = []
    for c in conversations:
        if c.get("resolved_at") and c.get("created_at"):
            try:
                rs = datetime.datetime.fromisoformat(c["resolved_at"].replace("Z", "+00:00"))
                cr = datetime.datetime.fromisoformat(c["created_at"].replace("Z", "+00:00"))
                handles.append((rs - cr).total_seconds())
            except (ValueError, TypeError):
                pass
    avg_handle_secs = round(statistics.mean(handles)) if handles else None

    # Backlog by queue
    backlog: dict[str, int] = {}
    tier_dist: dict[str, int] = {}
    for t in tickets:
        q    = t.get("queue_name") or "Unassigned"
        tier = str(t.get("tier", "?"))
        if t.get("status") != "resolved":
            backlog[q] = backlog.get(q, 0) + 1
        tier_dist[tier] = tier_dist.get(tier, 0) + 1

    return {
        "totalTickets":       total_tickets,
        "totalConversations": total_convs,
        "deflectionRate":     round(deflection_rate, 3),
        "resolutionRate":     round(resolution_rate, 3),
        "csatAvg":            csat_avg,
        "csatByTier":         csat_by_tier,
        "slaBreachRate":      round(sla_breach_rate, 3),
        "firstResponseSecs":  first_response_secs,
        "avgHandleSecs":      avg_handle_secs,
        "backlogByQueue":     backlog,
        "tierDistribution":   tier_dist,
        "tier0Resolved":      tier0_resolved,
        "resolvedCount":      resolved,
    }


@tool
def detect_support_anomalies(stats: dict) -> list:
    """
    Compare computed stats against industry benchmarks.
    Returns a list of anomaly flags for the LLM to narrate.

    DETERMINISTIC — no LLM judgment in this function.
    """
    flags = []

    deflection = stats.get("deflectionRate", 0)
    if deflection < BENCHMARKS["deflection_rate"]["target"]:
        flags.append({
            "metric":   "deflection_rate",
            "value":    deflection,
            "target":   BENCHMARKS["deflection_rate"]["target"],
            "industry": BENCHMARKS["deflection_rate"]["median"],
            "severity": "warning" if deflection >= 0.25 else "alert",
            "message":  f"Deflection rate {deflection:.0%} is below target {BENCHMARKS['deflection_rate']['target']:.0%} (industry median {BENCHMARKS['deflection_rate']['median']:.0%})",
        })

    resolution = stats.get("resolutionRate", 0)
    if resolution < BENCHMARKS["resolution_rate"]["target"]:
        flags.append({
            "metric":   "resolution_rate",
            "value":    resolution,
            "target":   BENCHMARKS["resolution_rate"]["target"],
            "industry": BENCHMARKS["resolution_rate"]["median"],
            "severity": "warning",
            "message":  f"Resolution rate {resolution:.0%} is below target {BENCHMARKS['resolution_rate']['target']:.0%}",
        })

    csat = stats.get("csatAvg")
    if csat and csat < BENCHMARKS["csat_avg"]["ai_baseline"]:
        flags.append({
            "metric":   "csat_avg",
            "value":    csat,
            "target":   BENCHMARKS["csat_avg"]["ai_baseline"],
            "severity": "warning",
            "message":  f"CSAT average {csat:.1f}/5 is below AI baseline {BENCHMARKS['csat_avg']['ai_baseline']:.1f}/5",
        })

    sla_breach = stats.get("slaBreachRate", 0)
    if sla_breach > BENCHMARKS["sla_breach_rate"]["target_max"]:
        flags.append({
            "metric":   "sla_breach_rate",
            "value":    sla_breach,
            "target":   BENCHMARKS["sla_breach_rate"]["target_max"],
            "severity": "alert" if sla_breach > 0.10 else "warning",
            "message":  f"SLA breach rate {sla_breach:.0%} exceeds target maximum {BENCHMARKS['sla_breach_rate']['target_max']:.0%}",
        })

    first_response_mins = (stats.get("firstResponseSecs") or 0) / 60
    if first_response_mins > BENCHMARKS["first_response_mins"]["target_max"]:
        flags.append({
            "metric":   "first_response_time",
            "value":    round(first_response_mins),
            "target":   BENCHMARKS["first_response_mins"]["target_max"],
            "severity": "warning",
            "message":  f"Average first response time {first_response_mins:.0f} min exceeds target {BENCHMARKS['first_response_mins']['target_max']} min",
        })

    return flags


@tool
def find_kb_gaps(tenant_id: str) -> dict:
    """
    Phase 9B: Detect knowledge-base gaps.

    Two gap types:
    1. Recurring questions with NO matching published KB article
       (inferred from confidence-gate rejections in the reporting table)
    2. Articles whose confidence-gate rejection rate is unusually high
       (the article exists but is consistently insufficient to ground responses)

    Returns { gaps: [{ type, description, frequency, suggestedTitle }] }
    """
    # Read confidence-gate rejection logs from reporting table
    reporting_table = _dynamo.Table(os.environ.get("REPORTING_TABLE", ""))

    # Scan for quality_scores records where confidence_gate_triggered = true
    resp = reporting_table.query(
        KeyConditionExpression = "pk = :pk",
        ExpressionAttributeValues = {":pk": f"{tenant_id}#report#quality_scores"},
        ScanIndexForward = False,
        Limit            = 100,
    )
    items = resp.get("Items", [])

    # Count topics where confidence gate fired
    gate_topics: dict[str, int] = {}
    for item in items:
        scores = item.get("scores", {})
        if scores.get("confidence_gate_triggered"):
            topic = item.get("customerQuery", "unknown")
            gate_topics[topic] = gate_topics.get(topic, 0) + 1

    # Build gap list: topics with ≥3 rejections are KB gaps
    gaps = []
    for topic, count in sorted(gate_topics.items(), key=lambda x: -x[1]):
        if count >= 3:
            # Generate a suggested article title from the topic
            suggested = f"Support article: {topic[:80]}" if topic != "unknown" else "Frequently asked question (topic unknown)"
            gaps.append({
                "type":           "repeated_confidence_gate_failure",
                "description":    topic,
                "frequency":      count,
                "suggestedTitle": suggested,
            })

    # Also check for articles with status=published but high rejection via embedding mismatch
    articles_result = _crm_read("search_knowledge_articles", {"query": "", "limit": 50, "status": "published"}, tenant_id)
    # Placeholder: in production, compare embedding retrieval hit rate vs confidence gate fire rate
    # For hackathon, just surface articles not reviewed in > 90 days as a quality concern
    articles = articles_result.get("result", []) or []
    now      = datetime.datetime.utcnow()
    for a in articles:
        reviewed_str = a.get("last_reviewed_at")
        if not reviewed_str:
            gaps.append({
                "type":           "article_never_reviewed",
                "description":    f"Article '{a['title']}' has never been reviewed",
                "frequency":      0,
                "articleId":      a.get("id"),
                "suggestedTitle": f"Review and update: {a['title']}",
            })
        else:
            try:
                reviewed = datetime.datetime.fromisoformat(reviewed_str.replace("Z", "+00:00"))
                days     = (now - reviewed.replace(tzinfo=None)).days
                if days > 90:
                    gaps.append({
                        "type":           "article_stale",
                        "description":    f"Article '{a['title']}' last reviewed {days} days ago",
                        "frequency":      0,
                        "articleId":      a.get("id"),
                        "suggestedTitle": f"Review and update: {a['title']}",
                    })
            except (ValueError, TypeError):
                pass

    return {"gaps": gaps[:10], "gapCount": len(gaps)}


@tool
def create_kb_gap_proposals(tenant_id: str, gaps: list) -> dict:
    """
    Phase 9B: Create Control Panel approval queue items for KB gaps.

    Each gap becomes a "write this article" or "review this article" task
    in the approval queue — closing the loop on Phase 8's confidence gate.
    Human confirms before any article is written or modified.
    """
    created = 0
    for gap in gaps:
        _crm_write(
            "upsert_activity",
            {
                "type":       "task",
                "actorType":  "agent",
                "actorId":    "support-insight-agent",
                "subject":    f"KB gap: {gap.get('suggestedTitle', 'Review knowledge base')}",
                "body":       (
                    f"Type: {gap.get('type')}\n"
                    f"Description: {gap.get('description')}\n"
                    f"Rejection frequency: {gap.get('frequency', 0)}\n\n"
                    f"Suggested action: {gap.get('suggestedTitle')}"
                ),
                "metadata": {
                    "requiresApproval": True,
                    "proposalType":     "kb_gap",
                    "gapType":          gap.get("type"),
                    "frequency":        gap.get("frequency", 0),
                    "articleId":        gap.get("articleId"),
                    "status":           "awaiting_approval",
                    "taggedAs":         "kb_maintenance",
                },
            },
            tenant_id,
        )
        created += 1

    return {"proposalsCreated": created, "totalGaps": len(gaps)}


@tool
def write_support_insight_report(
    tenant_id:   str,
    stats:       dict,
    anomalies:   list,
    narratives:  list,
    kb_gaps:     dict,
    period:      str,
) -> dict:
    """
    Write the support insight report to the reporting DynamoDB table.
    Same store as Forecasting & Insight (3A) — separate record type.

    narratives: plain-language flag strings the LLM generates from numeric output.
    """
    now = datetime.datetime.utcnow().isoformat() + "Z"
    ttl = int(datetime.datetime.utcnow().timestamp()) + 90 * 86_400

    table = _dynamo.Table(os.environ.get("REPORTING_TABLE", ""))
    item  = {
        "pk":            f"{tenant_id}#report#support_insight",
        "sk":            now,
        "report_type":   "support_insight",
        "tenant_id":     tenant_id,
        "period":        period,
        "stats":         stats,
        "anomalies":     anomalies,
        "narratives":    narratives,
        "kbGapCount":    kb_gaps.get("gapCount", 0),
        "generatedAt":   now,
        "ttl":           ttl,
    }
    table.put_item(Item=item)

    # Latest pointer for fast dashboard read
    latest = {**item, "sk": "latest"}
    table.put_item(Item=latest)

    return {"ok": True, "generatedAt": now, "anomalyCount": len(anomalies)}
