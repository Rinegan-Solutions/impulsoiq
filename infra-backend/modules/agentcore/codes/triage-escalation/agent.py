"""
Triage & Escalation Agent — Phase 7C.

The inbound counterpart to the Research & Enrichment Agent. Classifies every
new support contact across complexity/confidence and risk/sentiment axes,
producing a tier 0-3 routing decision.

KEY ARCHITECTURAL DECISION (v4 §7A):
  - Amazon Connect provides telephony/chat transport and Contact Lens analytics
  - This agent is the reasoning layer, invoked from Connect Contact Flows via Lambda
  - NOT Amazon Q in Connect (which would put classification outside the Control
    Panel, Evaluations pipeline, and Cedar policy governance)
  - Every classification decision flows through the same audit infrastructure as
    every sales-side agent decision

TIER 3 HARD RULE (v4 §7C):
  - Tier 3 (hard escalate) is enforced by the classify_triage tool as a
    deterministic routing rule when specific conditions are met
  - It is NEVER left to the LLM's discretion
  - This mirrors Phase 5B's AR tone-ladder enforcement pattern

Model: Nova 2 Lite, medium thinking — judgment-heavy classification
  (sentiment synthesis + risk synthesis + account context synthesis) is
  exactly the use case this model tier is designed for. (v4 §5)
"""
import json
import os
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    get_conversation_context,
    classify_triage,
    route_to_queue,
    stamp_sla_and_create_ticket,
)

MODEL = os.environ.get("TRIAGE_MODEL", "global.amazon.nova-2-lite-v1:0")

SYSTEM_PROMPT = """
You are the ImpulsoIQ Triage & Escalation Agent for the contact center (Phase 7).

Your job: classify every inbound support contact into the correct tier so it
reaches the right person or automated path at the right speed.

## Four tiers

- Tier 0: Auto-resolve. Clear, factual question answerable from known information.
  No emotional escalation signals. No financial/contractual language.
  Example: "Where can I download my invoice?" / "How do I reset my password?"

- Tier 1: Draft for review. Requires nuance, product-specific knowledge, or
  multiple steps — but no elevated risk. A human should review before sending.
  Example: Feature comparison question. Upgrade path question. Minor configuration help.

- Tier 2: Human required (agent-assisted context). Billing dispute, moderate negative
  sentiment, account health concern. The rep gets full context pre-loaded but
  composes the response themselves. The Resolution Agent is NOT drafted for these.

- Tier 3: Hard escalate — manager/senior rep, urgent, no agent involvement in the reply.
  You do NOT decide this tier by reasoning. The classify_triage tool decides it
  deterministically based on hard signals. You provide your suggested tier and
  reasoning as inputs to that tool, and the tool may override you.

## Execution flow

1. Call get_conversation_context to load the conversation, messages, contact record,
   renewal risk score, and prior unresolved ticket count.

2. Read the most recent message body and any Contact Lens sentiment score attached
   to it.

3. Based on the message content and account context, form your OWN assessment of the
   tier (0, 1, 2, or 3) and write a one-paragraph reasoning.

4. Call classify_triage with your suggested tier AND the deterministic signal inputs
   (message body, sentiment score, prior unresolved count, renewal risk). The tool
   may override your suggestion for Tier 3 — if it does, accept the override.

5. Call route_to_queue with the final tier and any relevant required skill
   (e.g., "billing", "technical", "general").

6. Call stamp_sla_and_create_ticket with all the outputs. This creates the ticket
   record with the correct SLA target and routes it to the right queue/rep.

## Rules — strictly enforced

- NEVER skip classify_triage. Your suggested tier is an input — it is not the
  final tier. The tool's output is the final tier.
- If the classify_triage tool applies an override, accept it and use the override
  tier for all subsequent tool calls. Do not argue with the override.
- For Tier 2 and 3: assigned_rep_id may be null — routing engine handles assignment.
- For Tier 0: the Resolution Agent (Phase 8) will be invoked next; your job is
  purely classification and routing, not resolution.
- CSAT and resolution are not your concern — those come later.

## Output format

After stamp_sla_and_create_ticket:
{
  "tier": 0|1|2|3,
  "ticketId": "<id>",
  "queueId": "<id>",
  "assignedRepId": "<id>" or null,
  "overrideApplied": true|false,
  "summary": "<one sentence describing the contact and routing decision>"
}
""".strip()


def run(event: dict) -> dict:
    """
    Entry point invoked by:
    - Amazon Connect Contact Flow (via Lambda) — new inbound voice/chat
    - connect-intake Lambda — new email/SMS/social message
    - Direct call from Coordinator for manual re-triage

    Event: { tenantId, conversationId, latestMessageBody?, sentimentScore? }
    """
    tenant_id       = event.get("tenantId", "")
    conversation_id = event.get("conversationId", "")

    if not tenant_id or not conversation_id:
        return {"error": "tenantId and conversationId are required", "status": "failed"}

    agent = Agent(
        model         = build_model(MODEL),
        system_prompt = SYSTEM_PROMPT,
        tools         = [
            get_conversation_context,
            classify_triage,
            route_to_queue,
            stamp_sla_and_create_ticket,
        ],
    )

    prompt = (
        f"Triage this inbound support contact.\n"
        f"Tenant ID:       {tenant_id}\n"
        f"Conversation ID: {conversation_id}\n"
        f"Message body:    {event.get('latestMessageBody', '(load from context)')[:500]}\n"
        f"Sentiment score: {event.get('sentimentScore', 'N/A')}\n\n"
        f"Follow the execution flow. classify_triage decides the final tier."
    )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "conversationId": conversation_id}
