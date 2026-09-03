"""
Triage & Escalation Agent — tool definitions (Phase 7C).

Classification axes (v4 §7C):
  1. Complexity/confidence: can this be resolved from known information?
  2. Risk/sentiment:        Contact Lens sentiment + refund/legal/cancellation language

Four tiers:
  Tier 0 — Auto-resolve:          Resolution Agent responds directly (Phase 8)
  Tier 1 — Draft for review:      Resolution Agent drafts, human reviews/sends
  Tier 2 — Human required:        Routed to rep with full context; no draft
  Tier 3 — Hard escalate:         Manager/senior rep, tagged urgent

TIER 3 IS A ROUTING RULE, NOT AGENT DISCRETION.
The classify_triage tool enforces Tier 3 deterministically when:
  - The message contains refund/cancellation/legal language, OR
  - The contact has repeated unresolved tickets (>= 3 in 30 days), OR
  - Sentiment score < -0.6
These conditions OVERRIDE the LLM's own classification suggestion.
(v4 §7C: "structurally guaranteed by routing-layer rule, not agent judgment")

SLA targets are stamped at ticket creation from the queue's sla_policy —
not estimated by the agent.
"""
import json
import os
import re
import datetime
import boto3
from strands import tool

REGION  = os.environ.get("AWS_REGION", "eu-west-2")
_lambda = boto3.client("lambda", region_name=REGION)


def _crm_read(operation: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_READ_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({"operation": operation, "payload": payload, "tenantId": tenant_id}).encode(),
    )
    return json.loads(resp["Payload"].read())


def _crm_write(operation: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_WRITE_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({
            "operation": operation, "payload": payload, "tenantId": tenant_id,
            "actorType": "agent", "actorId": "triage-escalation-agent",
        }).encode(),
    )
    return json.loads(resp["Payload"].read())


# ── Hard-escalation keyword patterns (deterministic, not LLM) ─────────────────

TIER3_PATTERNS = re.compile(
    r"\b(refund|cancel|cancell?ation|chargeback|dispute|legal|lawsuit|attorney|lawyer|"
    r"court|fraud|threat|scam|complaint|ombudsman|regulatory|GDPR request|data request|"
    r"escalat|executive|CEO|president)\b",
    re.IGNORECASE,
)


def _deterministic_tier_override(
    body: str,
    sentiment_score: float,
    prior_unresolved_count: int,
) -> int | None:
    """
    Returns a forced tier if hard-escalation criteria are met, else None.
    Called BEFORE the LLM classification — if this returns a value, it
    overrides whatever the LLM would suggest.
    """
    # Tier 3: financial/legal language
    if TIER3_PATTERNS.search(body or ""):
        return 3
    # Tier 3: very negative sentiment
    if sentiment_score is not None and sentiment_score < -0.6:
        return 3
    # Tier 3: repeated unresolved tickets (frustration signal)
    if prior_unresolved_count >= 3:
        return 3
    return None


@tool
def get_conversation_context(tenant_id: str, conversation_id: str) -> dict:
    """
    Fetch the conversation, its messages, the linked contact, and account
    context (renewal risk from Forecasting Agent, prior ticket count).

    A customer with a high renewal-risk score gets a lower auto-resolve
    threshold by design — the cost of mishandling them is higher than average.
    (v4 §7C point 3)
    """
    result = {
        "conversation": _crm_read("get_conversation", {"id": conversation_id}, tenant_id).get("result"),
        "messages":     _crm_read("get_messages", {"conversationId": conversation_id, "limit": 20}, tenant_id).get("result", []),
    }
    conv = result["conversation"] or {}
    contact_id = conv.get("contact_id") or conv.get("contactId")
    if contact_id:
        contact = _crm_read("get_contact", {"id": contact_id}, tenant_id).get("result")
        result["contact"]     = contact
        result["enrichment"]  = (contact or {}).get("enrichment_json", {})
        # Pull prior ticket count (last 30 days) — feeds Tier 3 check
        prior = _crm_read(
            "count_prior_tickets",
            {"contactId": contact_id, "daysSince": 30},
            tenant_id,
        )
        result["priorUnresolvedTickets"] = prior.get("count", 0)
    return result


@tool
def classify_triage(
    tenant_id:              str,
    conversation_id:        str,
    message_body:           str,
    sentiment_score:        float,
    prior_unresolved_count: int,
    renewal_risk_score:     float,
    llm_suggested_tier:     int,
    llm_reasoning:          str,
) -> dict:
    """
    Produce the final triage tier.

    HARD RULE: deterministic overrides are checked first.
    The LLM's suggestion (llm_suggested_tier) is only used if no override fires.

    Risk adjustments applied BEFORE returning:
    - renewal_risk_score >= 0.7 → never allow Tier 0 (bump to Tier 1 minimum)
    - prior_unresolved_count >= 2 → bump one tier higher than suggested

    Returns { tier: int, overrideApplied: bool, overrideReason: str|None, finalReasoning: str }
    """
    override  = _deterministic_tier_override(message_body, sentiment_score, prior_unresolved_count)
    override_reason = None
    override_applied = False

    if override is not None:
        tier = override
        override_applied = True
        if TIER3_PATTERNS.search(message_body or ""):
            override_reason = "Hard-escalation language detected (refund/legal/cancellation)"
        elif sentiment_score is not None and sentiment_score < -0.6:
            override_reason = f"Very negative sentiment ({sentiment_score:.2f})"
        else:
            override_reason = f"Repeated unresolved contacts ({prior_unresolved_count} in 30 days)"
    else:
        tier = llm_suggested_tier

        # Risk adjustments
        if renewal_risk_score >= 0.7 and tier == 0:
            tier = 1
            override_reason = f"High renewal-risk account ({renewal_risk_score:.0%}) — minimum Tier 1"
            override_applied = True
        if prior_unresolved_count >= 2 and tier < 3:
            tier = min(tier + 1, 3)
            override_reason = f"Prior unresolved tickets ({prior_unresolved_count}) — tier bumped"
            override_applied = True

    final_reasoning = (
        f"[OVERRIDE: {override_reason}] " if override_applied else ""
    ) + llm_reasoning

    return {
        "tier":            tier,
        "overrideApplied": override_applied,
        "overrideReason":  override_reason,
        "finalReasoning":  final_reasoning[:2000],
    }


@tool
def route_to_queue(
    tenant_id:      str,
    ticket_id:      str,
    tier:           int,
    required_skill: str = "",
) -> dict:
    """
    Deterministic routing — finds the best queue for this ticket based on
    required skills, then the rep with lowest concurrent_ticket_count who
    has the required skill. (Non-agentic rules engine per v4 §7C point 4)

    Returns { queueId, assignedRepId, queueName }
    """
    queues = _crm_read("list_queues", {"requiredSkill": required_skill}, tenant_id)
    queue_list = queues.get("result", [])
    if not queue_list:
        return {"queueId": None, "assignedRepId": None, "queueName": "default"}

    # Simple: pick first queue matching required skill
    selected = queue_list[0]
    queue_id = selected.get("id")

    # For Tier 0/1: find available rep with lowest concurrent load
    assigned_rep = None
    if tier <= 1:
        reps = _crm_read("list_available_reps", {"queueId": queue_id}, tenant_id)
        rep_list = reps.get("result", [])
        if rep_list:
            assigned_rep = sorted(rep_list, key=lambda r: r.get("concurrent_ticket_count", 99))[0].get("rep_id")

    return {
        "queueId":      queue_id,
        "assignedRepId": assigned_rep,
        "queueName":    selected.get("name", "General"),
    }


@tool
def stamp_sla_and_create_ticket(
    tenant_id:       str,
    conversation_id: str,
    tier:            int,
    queue_id:        str,
    assigned_rep_id: str,
    reasoning:       str,
    priority:        str = "normal",
) -> dict:
    """
    Create the ticket record with SLA target computed from the queue's sla_policy.
    SLA target is stamped at creation time — not estimated by the agent.
    (v4 §7C point 5)

    For Tier 3: priority is always set to 'urgent' regardless of the caller's value.
    """
    if tier == 3:
        priority = "urgent"

    # Read queue SLA policy
    sla_target_at = None
    if queue_id:
        queue_info = _crm_read("get_support_queue", {"id": queue_id}, tenant_id)
        sla_policy_id = (queue_info.get("result") or {}).get("sla_policy_id")
        if sla_policy_id:
            policy = _crm_read("get_sla_policy", {"id": sla_policy_id}, tenant_id)
            first_response_mins = (policy.get("result") or {}).get("first_response_target_minutes", 60)
            sla_target_at = (
                datetime.datetime.utcnow() + datetime.timedelta(minutes=first_response_mins)
            ).isoformat() + "Z"

    result = _crm_write(
        "upsert_ticket",
        {
            "conversationId":           conversation_id,
            "queueId":                  queue_id,
            "tier":                     tier,
            "assignedRepId":            assigned_rep_id or None,
            "priority":                 priority,
            "slaTargetAt":              sla_target_at,
            "classificationReasoning":  reasoning[:2000],
        },
        tenant_id,
    )
    return result
