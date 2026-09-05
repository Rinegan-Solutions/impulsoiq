"""
Nurture & Follow-up Agent — Phase 2F.

Manages the post-first-touch nurture cadence for contacts who have not
yet converted after initial outreach.

Decision-making is supported by a deterministic rules engine (decide_next_action).
The LLM's role is to orchestrate the tools, interpret results, and produce
a clear action — not to invent rules.

ARM64 container; model: Claude Sonnet (configurable via NURTURE_MODEL env var).
"""
import json
import os
import datetime
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    get_contact_engagement,
    get_contact_cadence_memory,
    update_cadence_memory,
    decide_next_action,
    queue_follow_up,
)

SYSTEM_PROMPT = """
You are the ImpulsoIQ Nurture & Follow-up agent. Your job is to manage the
ongoing contact cadence for prospects who haven't yet converted after initial
outreach — keeping them warm without over-contacting.

## Decision flow (follow this order exactly)

1. Call get_contact_cadence_memory to understand where this contact is in
   the nurture sequence (touch count, last touch type, next planned action).

2. Call get_contact_engagement to read recent activities and engagement signals.
   Compute days_since_last_touch from the lastActivityAt timestamp.

3. Call decide_next_action with the engagement signals, days_since_last_touch,
   max_touches_remaining (from the event), and consent_channels.
   YOU MUST USE THIS TOOL — do not decide the action yourself by reasoning.

4. Act on the result:
   - If action = 'email': Queue a follow-up email via queue_follow_up.
     Then call update_cadence_memory with nextAction='email'.
   - If action = 'call': Queue a follow-up call via queue_follow_up.
     Then call update_cadence_memory with nextAction='call'.
   - If action = 'stop': Call update_cadence_memory with nextAction='stop'.
     Do NOT schedule any more follow-ups. Mark the contact as do-not-contact
     in your output so the Coordinator can update the contact's stage.
   - If action = 'wait': Call update_cadence_memory with the current state
     unchanged. Do NOT queue a follow-up — the SFN WaitForEngagement state
     will trigger this agent again at the right time.

5. Always call update_cadence_memory to record the decision, even for 'wait'.

## Rules — strictly enforced

- DECISION ENGINE ONLY: Always use decide_next_action. Never decide the next
  action by LLM reasoning — the rules must be applied consistently.
- RESPECT CONSENT: The consent_channels list in the event dictates which
  channels are available. Never recommend a channel that isn't in the list.
- MAX TOUCHES: Honour max_touches_remaining. If it's 0, the action MUST be 'stop'.
- CADENCE STATE: Always update cadence memory after each decision so the
  next invocation has accurate state.

## Output format

{
  "action":         "email|call|stop|wait",
  "reason":         "<reason from decide_next_action>",
  "channel":        "email|call|null",
  "scheduledFor":   "<ISO datetime or null>",
  "touchCount":     <int>,
  "markDNC":        <bool>  // true if action=stop and consent exhausted
}
""".strip()

MODEL = os.environ.get("NURTURE_MODEL", "global.amazon.nova-2-lite-v1:0")


def run(event: dict) -> dict:
    """
    Entry point invoked by:
    - Step Functions (WaitForEngagement timeout → nurture evaluation)
    - Coordinator (direct delegation after email non-response)

    Expected event:
      { tenantId, contactId, campaignId, agentRunId,
        maxTouchesRemaining, consentChannels: ['email', 'call'],
        engagementSignals?: { email_opened, email_replied, link_clicked } }
    """
    agent = Agent(
        model=build_model(MODEL),
        system_prompt=SYSTEM_PROMPT,
        tools=[
            get_contact_engagement,
            get_contact_cadence_memory,
            update_cadence_memory,
            decide_next_action,
            queue_follow_up,
        ],
    )

    tenant_id              = event.get("tenantId", "")
    contact_id             = event.get("contactId", "")
    campaign_id            = event.get("campaignId", "")
    agent_run_id           = event.get("agentRunId", "")
    max_touches_remaining  = event.get("maxTouchesRemaining", 3)
    consent_channels       = event.get("consentChannels", [])
    engagement_signals     = event.get("engagementSignals", {})

    # Compute a reasonable follow-up time: 3 days from now
    follow_up_date = (datetime.datetime.utcnow() + datetime.timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")

    prompt = (
        f"Evaluate the nurture cadence for this contact.\n"
        f"Tenant ID:              {tenant_id}\n"
        f"Contact ID:             {contact_id}\n"
        f"Campaign ID:            {campaign_id}\n"
        f"Agent Run ID:           {agent_run_id}\n"
        f"Max touches remaining:  {max_touches_remaining}\n"
        f"Consent channels:       {json.dumps(consent_channels)}\n"
        f"Engagement signals:     {json.dumps(engagement_signals)}\n"
        f"Suggested follow-up at: {follow_up_date}\n\n"
        f"Follow the decision flow exactly. Use decide_next_action for the action decision."
    )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "contactId": contact_id}
