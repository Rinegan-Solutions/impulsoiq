"""
Resolution Agent — Phase 8A.

Provides fast, grounded, appropriately-scoped resolution for support contacts.
Operates ONLY on Tier-0 and Tier-1 conversations. (v4 §8A)

Why this is a separate agent, not a reuse of Outreach & Drafting (2C):
  1. Must ground every response in cited knowledge-base articles (factual accuracy
     requirement outbound drafting doesn't have in the same way)
  2. Confidence gate can OVERRIDE Triage's Tier-0 classification
  3. Has a scoped action surface for Tier-0 (not just text drafting)
  4. An ungrounded confident answer is worse than routing to human

Confidence gate (single most important reliability guardrail in this phase):
  retrieve_from_kb → assess_confidence → if not sufficient → stage_insufficient_grounding
  This architecture makes the honest "I don't know, route to human" path
  the DEFAULT failure mode, not an edge case. (v4 §8A point 4)

Tier-0 action surface (Cedar policy enforced in tools.py):
  ALLOWED:  informational replies, attach article, non-financial field updates
  NEVER:    refunds, cancellations, billing changes, or financial/contractual actions

Model: Nova 2 Lite, medium thinking (v4 §5 — consistent with Triage)
"""
import json
import os
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    retrieve_from_kb,
    check_article_freshness,
    assess_confidence,
    stage_insufficient_grounding,
    send_tier0_response,
    stage_tier1_draft,
    suggest_macro,
    trigger_csat_prompt,
)

MODEL = os.environ.get("RESOLUTION_MODEL", "global.amazon.nova-2-lite-v1:0")

SYSTEM_PROMPT = """
You are the ImpulsoIQ Resolution Agent. You draft or send responses for Tier-0
(auto-resolve) and Tier-1 (draft for review) support conversations.

## When you are invoked

You are only invoked when Triage has classified a conversation as Tier-0 or Tier-1.
Tiers 2 and 3 NEVER reach you — the routing layer handles those.

## Critical rules — strictly enforced

1. GROUNDING FIRST, ALWAYS: Your first action for every conversation is
   retrieve_from_kb. No exceptions. You do not draft any response before
   calling retrieve_from_kb.

2. CONFIDENCE GATE: Call assess_confidence after retrieve_from_kb and
   check_article_freshness. If assess_confidence returns sufficient=False,
   call stage_insufficient_grounding immediately and STOP. Do NOT guess.
   Do NOT draft a response when you lack sufficient KB grounding.
   An honest "route to human" is always better than an ungrounded wrong answer.

3. CITATIONS ARE MANDATORY: Every response — Tier 0 or Tier 1 — must include
   citations listing the specific knowledge_article records it's grounded in.
   If you cannot cite a source for a claim, remove that claim from the response.

4. TIER-0 POLICY: Call send_tier0_response only for Tier-0 conversations.
   The tool itself enforces Cedar policy — it will block financial/contractual
   actions deterministically. Accept any block and call stage_tier1_draft instead.

5. TIER-1 DRAFTS: Call stage_tier1_draft for Tier-1 conversations. The rep
   reviews and sends. Every edit a rep makes is a quality signal — write drafts
   that require minimal editing.

6. MACRO SUGGESTION: After drafting, call suggest_macro. Include the best
   macro ID (if any) in stage_tier1_draft's suggested_macro_id field.

7. CSAT TRIGGER: After a Tier-0 send completes, call trigger_csat_prompt with
   a 30-minute delay. (Phase 8D — reuses Nurture Agent pattern)

## Execution flow

1. retrieve_from_kb (query = customer's question or issue summary)
2. If not sufficient → stage_insufficient_grounding → STOP
3. check_article_freshness on retrieved articles
4. assess_confidence (articles, query, freshness_check)
5. If not sufficient → stage_insufficient_grounding → STOP
6. suggest_macro (in parallel with drafting)
7. Draft response grounded in articles (cite each article used)
8. [Tier-0] send_tier0_response → if blocked, stage_tier1_draft instead
   [Tier-1] stage_tier1_draft with citations and suggested macro
9. [Tier-0 only] trigger_csat_prompt (30 min delay)

## Response quality

- Be specific, not vague. "Navigate to Settings → Billing → Invoices" is better
  than "check your account settings."
- Cite the article by title: "[From: How to download your invoice]"
- Keep Tier-0 responses under 150 words — the customer asked a question, not a
  lecture.
- Tier-1 drafts can be longer if the question is complex.

## Output format

After completing all tool calls:
{
  "resolution": "sent" | "staged" | "routed_to_human",
  "tier": 0 | 1,
  "citationCount": N,
  "confidenceGateTriggered": true | false,
  "conversationId": "<id>"
}
""".strip()


def run(event: dict) -> dict:
    """
    Entry point invoked by:
    - Coordinator agent (after Triage classifies Tier-0 or Tier-1)
    - Connect Contact Flow (via connect-intake Lambda) for Tier-0/1 voice contacts

    Event: { tenantId, conversationId, ticketId, tier (0|1),
             customerMessage, contactId? }
    """
    tenant_id       = event.get("tenantId", "")
    conversation_id = event.get("conversationId", "")
    ticket_id       = event.get("ticketId", "")
    tier            = int(event.get("tier", 1))
    customer_msg    = event.get("customerMessage", "")

    if not tenant_id or not conversation_id:
        return {"error": "tenantId and conversationId are required", "status": "failed"}

    if tier not in (0, 1):
        return {
            "error":  f"Resolution Agent only handles Tier-0 and Tier-1. Got tier={tier}.",
            "status": "wrong_tier",
        }

    agent = Agent(
        model         = build_model(MODEL),
        system_prompt = SYSTEM_PROMPT,
        tools         = [
            retrieve_from_kb,
            check_article_freshness,
            assess_confidence,
            stage_insufficient_grounding,
            send_tier0_response,
            stage_tier1_draft,
            suggest_macro,
            trigger_csat_prompt,
        ],
    )

    prompt = (
        f"Resolve this support conversation.\n"
        f"Tenant ID:       {tenant_id}\n"
        f"Conversation ID: {conversation_id}\n"
        f"Ticket ID:       {ticket_id}\n"
        f"Tier:            {tier}\n"
        f"Customer message: {customer_msg[:1000]}\n\n"
        f"Follow the execution flow. Call retrieve_from_kb first."
    )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "conversationId": conversation_id}
