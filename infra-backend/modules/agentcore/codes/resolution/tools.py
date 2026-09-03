"""
Resolution Agent — tool definitions (Phase 8A).

The Resolution Agent drafts or sends support responses grounded in the
knowledge base. It operates ONLY on Tier-0 and Tier-1 conversations.
Tiers 2 and 3 never reach it — Triage routes those directly to a human.

CRITICAL: Confidence gate (v4 §8A point 4)
  If KB retrieval doesn't surface a sufficiently relevant, sufficiently current
  article, the agent does NOT guess — it calls stage_insufficient_grounding to
  route the conversation to a human. An ungrounded confident answer is worse than
  an honest "I don't know," and this architecture makes the honest path the
  default failure mode.

Tier-0 Action Surface (v4 §8C) — Cedar policy enforced in this file:
  ALLOWED:  informational replies, attach article, update non-financial fields,
            trigger password reset via auth system
  NEVER:    refund, cancel subscription, modify billing, any financial/contractual
            action — enforced deterministically by _check_tier0_policy()
"""
import json
import os
import datetime
import re
import boto3
from strands import tool

REGION  = os.environ.get("AWS_REGION", "eu-west-2")
_lambda = boto3.client("lambda", region_name=REGION)

# ── Tier-0 Cedar policy enforcement (deterministic) ───────────────────────────

# These are NEVER allowed at Tier 0, regardless of confidence or context.
# (v4 §8C: "enforced as a hard policy rule, not agent judgment")
_TIER0_PROHIBITED_ACTIONS = frozenset({
    "refund", "cancel_subscription", "cancel", "modify_billing",
    "delete_account", "issue_credit", "chargeback", "subscription_cancel",
    "billing_adjustment", "payment_reversal",
})

_TIER0_PROHIBITED_PATTERNS = re.compile(
    r"\b(refund|cancel|cancell?ation|billing change|credit|chargeback|"
    r"account (delete|close|terminat)|subscription (cancel|terminat))\b",
    re.IGNORECASE,
)


def _check_tier0_policy(response_body: str, action_type: str = "send_reply") -> dict:
    """
    Deterministic Cedar-policy check. Returns { allowed, reason }.
    Called before every Tier-0 send — cannot be bypassed.
    """
    if action_type.lower() in _TIER0_PROHIBITED_ACTIONS:
        return {
            "allowed": False,
            "reason": f"Tier-0 action '{action_type}' is prohibited by policy. "
                      f"Refunds, cancellations, and billing changes require a human rep.",
        }
    if _TIER0_PROHIBITED_PATTERNS.search(response_body or ""):
        return {
            "allowed": False,
            "reason": "Response contains language related to refunds, cancellations, or "
                      "billing changes — route to human rep (Tier 2).",
        }
    return {"allowed": True, "reason": None}


# ── CRM helpers ────────────────────────────────────────────────────────────────

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
            "actorType": "agent", "actorId": "resolution-agent",
        }).encode(),
    )
    return json.loads(resp["Payload"].read())


# ── Tools ──────────────────────────────────────────────────────────────────────

@tool
def retrieve_from_kb(tenant_id: str, query: str, min_relevance: float = 0.65) -> dict:
    """
    ALWAYS call this first. Retrieve the most relevant published knowledge_article
    records for the customer's question.

    Uses the same query_memory Gateway tool as the rest of the system —
    knowledge articles are embedded into S3 Vectors in Phase 7E so they are
    semantically searchable from Phase 8 onward.

    Returns { articles: [{ id, title, body_excerpt, relevance, last_reviewed_at }],
              sufficient: bool (True if >= 1 article meets min_relevance) }

    If sufficient=False, you MUST call stage_insufficient_grounding immediately.
    Do NOT draft a response when sufficient=False.
    """
    result = _crm_read(
        "search_knowledge_articles",
        {"query": query, "limit": 5, "status": "published"},
        tenant_id,
    )
    articles = result.get("result", []) or []

    # Score relevance (keyword fallback for hackathon; production uses S3 Vectors cosine)
    query_terms = set(query.lower().split())
    scored = []
    for a in articles:
        text = (a.get("title", "") + " " + a.get("body", "")).lower()
        hits = sum(1 for term in query_terms if term in text)
        relevance = min(hits / max(len(query_terms), 1), 1.0)
        if relevance >= min_relevance:
            scored.append({
                "id":             a.get("id"),
                "title":          a.get("title"),
                "body_excerpt":   (a.get("body", "") or "")[:300],
                "relevance":      round(relevance, 2),
                "last_reviewed_at": a.get("last_reviewed_at"),
                "version":        a.get("version", 1),
            })

    scored.sort(key=lambda x: x["relevance"], reverse=True)
    return {
        "articles":   scored[:3],
        "sufficient": len(scored) > 0,
        "query":      query,
    }


@tool
def check_article_freshness(tenant_id: str, articles: list) -> dict:
    """
    Check whether the retrieved articles are current enough to ground a response.

    Articles not reviewed in > 90 days are flagged as potentially stale — the
    confidence gate (assess_confidence) will take this into account.

    Returns { all_fresh: bool, stale_articles: [{ id, title, days_since_review }] }
    """
    stale    = []
    now      = datetime.datetime.utcnow()
    for a in articles:
        reviewed_str = a.get("last_reviewed_at")
        if not reviewed_str:
            stale.append({**a, "days_since_review": 999, "reason": "never reviewed"})
            continue
        try:
            reviewed = datetime.datetime.fromisoformat(reviewed_str.replace("Z", "+00:00"))
            days     = (now - reviewed.replace(tzinfo=None)).days
            if days > 90:
                stale.append({**a, "days_since_review": days, "reason": f"{days} days since last review"})
        except ValueError:
            stale.append({**a, "days_since_review": 999, "reason": "unparseable review date"})

    return {"all_fresh": len(stale) == 0, "stale_articles": stale}


@tool
def assess_confidence(
    articles:       list,
    query:          str,
    freshness_check: dict,
) -> dict:
    """
    Determine whether the retrieved articles provide sufficient grounding for
    a response. This is the confidence gate — if it fails, the agent MUST
    route to human rather than guessing.

    Confidence is reduced by:
    - Fewer or lower-relevance articles
    - Stale articles (>90 days since review)

    Returns { sufficient: bool, confidence: float, reason: str }
    """
    if not articles:
        return {
            "sufficient":  False,
            "confidence":  0.0,
            "reason":      "No relevant knowledge articles found. Routing to human rep.",
        }

    top_relevance = articles[0].get("relevance", 0.0)
    stale_count   = len(freshness_check.get("stale_articles", []))

    # Base confidence from top article relevance
    confidence = top_relevance

    # Reduce for stale articles
    if stale_count > 0:
        confidence = confidence * (1.0 - 0.2 * stale_count)

    # Minimum threshold to proceed
    sufficient = confidence >= 0.6

    reason = (
        f"Top article relevance: {top_relevance:.0%}. "
        + (f"{stale_count} stale article(s) reducing confidence. " if stale_count else "")
        + ("Sufficient to proceed." if sufficient else "Confidence too low — routing to human.")
    )

    return {"sufficient": sufficient, "confidence": round(confidence, 2), "reason": reason}


@tool
def stage_insufficient_grounding(
    tenant_id:       str,
    ticket_id:       str,
    conversation_id: str,
    query:           str,
    reason:          str,
) -> dict:
    """
    Route conversation to human rep because the knowledge base doesn't have
    sufficient grounding for an auto-response.

    This is NOT a failure — it's the intended behavior of the confidence gate.
    An honest "I don't know" is better than an ungrounded confident wrong answer.
    (v4 §8A point 4)

    Updates the ticket tier from 0 → 1 and adds a Control Panel note explaining why.
    """
    # Bump tier to 1 (human review required) and log the reason
    _crm_write(
        "upsert_ticket",
        {
            "id":   ticket_id,
            "tier": 1,
            "classificationReasoning": (
                f"CONFIDENCE GATE: Resolution Agent could not find sufficient KB grounding. "
                f"Query: '{query}'. Reason: {reason}. Routed to Tier-1 human review."
            ),
        },
        tenant_id,
    )
    return {
        "action":    "routed_to_human",
        "tier":       1,
        "ticketId":  ticket_id,
        "reason":    reason,
    }


@tool
def send_tier0_response(
    tenant_id:       str,
    conversation_id: str,
    ticket_id:       str,
    response_body:   str,
    citations:       list,
    action_type:     str = "send_reply",
) -> dict:
    """
    Send a Tier-0 response directly to the customer.

    Cedar policy check runs BEFORE every send. Financial/contractual actions
    are blocked deterministically — not by agent judgment. (v4 §8C)

    citations: list of { article_id, article_title, excerpt } — REQUIRED.
    Every Tier-0 response must cite the knowledge article(s) it's grounded in.
    """
    # Policy check — runs before anything else
    policy = _check_tier0_policy(response_body, action_type)
    if not policy["allowed"]:
        return {
            "sent":   False,
            "blocked": True,
            "reason":  policy["reason"],
            "action":  "route_to_human",
        }

    if not citations:
        return {
            "sent":    False,
            "blocked": True,
            "reason":  "Citations are required for every Tier-0 response. Retrieve from KB first.",
        }

    # Write the outgoing message
    msg_result = _crm_write(
        "upsert_message",
        {
            "conversationId": conversation_id,
            "channel":        "agent",  # indicates agent-generated reply
            "senderType":     "agent",
            "senderId":       "resolution-agent",
            "body":           response_body,
            "metadata":       {"citations": citations, "tier": 0, "autoSent": True},
        },
        tenant_id,
    )

    # Update conversation status
    _crm_write(
        "resolve_conversation",
        {"id": conversation_id, "resolvedAt": datetime.datetime.utcnow().isoformat() + "Z"},
        tenant_id,
    )

    return {
        "sent":           True,
        "messageId":      msg_result.get("id"),
        "conversationId": conversation_id,
        "citationCount":  len(citations),
    }


@tool
def stage_tier1_draft(
    tenant_id:       str,
    ticket_id:       str,
    conversation_id: str,
    draft_body:      str,
    citations:       list,
    suggested_macro_id: str = "",
) -> dict:
    """
    Stage a Tier-1 draft in the rep queue UI for human review.

    The rep sees the draft with its citations, can edit or discard it, and sends
    when satisfied. Every edit is a signal to Phase 3D's Evaluations pipeline
    (draft-acceptance-without-edit rate). (v4 §8A point 6)

    citations: list of { article_id, article_title, excerpt } — required for Tier-1 too.
    Every drafted reply must be traceable to specific published KB records.
    """
    result = _crm_write(
        "upsert_activity",
        {
            "conversationId": conversation_id,
            "type":           "note",
            "actorType":      "agent",
            "actorId":        "resolution-agent",
            "subject":        "Resolution draft (Tier-1 — awaiting rep review)",
            "body":           draft_body,
            "metadata": {
                "isDraft":         True,
                "tier":            1,
                "citations":       citations,
                "suggestedMacroId": suggested_macro_id or None,
                "requiresApproval": True,
                "status":          "awaiting_approval",
            },
        },
        tenant_id,
    )
    return {
        "staged":         True,
        "activityId":     result.get("id"),
        "ticketId":       ticket_id,
        "citationCount":  len(citations),
        "macroSuggested": bool(suggested_macro_id),
    }


@tool
def suggest_macro(tenant_id: str, message_body: str, limit: int = 3) -> dict:
    """
    Suggest the most relevant existing macros based on the customer's message.
    (v4 §8B — saves the rep a search without replacing their judgment)

    Uses keyword matching against macro title + tags.
    Returns { macros: [{ id, title, relevance }] }
    """
    result = _crm_read("get_macros", {"limit": 20}, tenant_id)
    macros = result.get("result", []) or []

    query_terms = set(message_body.lower().split())
    scored = []
    for m in macros:
        text = (m.get("title", "") + " " + " ".join(m.get("tags", []))).lower()
        hits = sum(1 for term in query_terms if len(term) > 3 and term in text)
        if hits > 0:
            scored.append({
                "id":        m.get("id"),
                "title":     m.get("title"),
                "relevance": round(hits / max(len(query_terms), 1), 2),
            })

    scored.sort(key=lambda x: x["relevance"], reverse=True)
    return {"macros": scored[:limit]}


@tool
def trigger_csat_prompt(tenant_id: str, conversation_id: str, delay_minutes: int = 30) -> dict:
    """
    Schedule a CSAT prompt to be sent after resolution.

    Reuses the Nurture Agent / follow-up pattern — NOT a new capability.
    If the customer replies with dissatisfaction, the Nurture Agent re-triggers
    Triage on the new message (v4 §8D).

    delay_minutes: wait before sending the CSAT prompt (default 30 min post-resolution)
    """
    send_at = (
        datetime.datetime.utcnow() + datetime.timedelta(minutes=delay_minutes)
    ).isoformat() + "Z"

    _crm_write(
        "upsert_activity",
        {
            "conversationId": conversation_id,
            "type":           "task",
            "actorType":      "agent",
            "actorId":        "resolution-agent",
            "subject":        "Send CSAT prompt",
            "metadata": {
                "taskType":    "csat_prompt",
                "scheduledAt": send_at,
                "status":      "scheduled",
            },
        },
        tenant_id,
    )
    return {"scheduled": True, "sendAt": send_at, "conversationId": conversation_id}
