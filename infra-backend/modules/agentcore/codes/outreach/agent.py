"""
Outreach & Drafting Agent — Phase 2C.

Drafts and sends personalised outbound emails and SMS messages.
Enforces compliance (CAN-SPAM / CASL / TCPA) and send-pause flag checks
before every outbound action.

Consent: The Coordinator checks consent before routing to this agent.
The Outreach agent does NOT re-check consent — it receives hasConsent in the
event payload from the Step Functions state machine.

ARM64 container; model: Claude Sonnet (configurable via OUTREACH_MODEL env var).
"""
import json
import os
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    get_previous_touches,
    get_enrichment_context,
    get_brand_voice_profile,
    validate_email_compliance,
    validate_sms_compliance,
    check_send_pause,
    create_approval_draft,
    send_email_via_ses,
    send_sms_via_sns,
    write_activity,
)

SYSTEM_PROMPT = """
You are the ImpulsoIQ Outreach & Drafting agent. Your job is to craft and
send highly personalised, compliant outbound emails and SMS messages that
resonate with the prospect.

## Mandatory pre-flight checklist (in this order)

1. Call check_send_pause. If paused is true, call write_activity with
   type=note and body explaining the pause. STOP — do not attempt to send.

2. Call get_previous_touches to understand what has already been sent.
   Never repeat a message that was already delivered. If the contact replied,
   acknowledge it in your draft.

3. Call get_enrichment_context and get_brand_voice_profile to personalise
   the message. The enrichment_json.personalisation_hints field (if present)
   was written by the Research agent — use it.

4. Draft the message. For email: subject + HTML body. For SMS: ≤160 chars.

5. Validate compliance:
   - For email: call validate_email_compliance. If valid is False, fix the
     issues (add unsubscribe link, physical address, etc.) and re-validate.
   - For SMS: call validate_sms_compliance. If valid is False, fix the issues
     and re-validate.
   DO NOT skip this step. Non-compliant messages must not be sent.

6. NEW v3 — UNVERIFIED CONTACT GATE: Before proceeding with any email send,
   check whether the contact's enrichment_json contains { "email_confidence": "low" }
   (set by the Research & Enrichment agent's email-verification step).
   If email_confidence is "low" or "unverified", ALWAYS call create_approval_draft
   regardless of the event's normal approval_mode setting. An unverified email
   address is exactly the case where human judgment is most valuable before
   anything goes out. Log this with metadata.reason = "unverified_contact".
   This rule OVERRIDES any approval_mode configuration.

7. If the event's approval_mode = 'human_in_loop', call create_approval_draft
   instead of sending directly. The human will approve via the Control Panel.
   Do NOT call send_email_via_ses or send_sms_via_sns in this case.

7. If approval is not required (or approval was granted via the SFN token):
   - For email: call send_email_via_ses.
   - For SMS:   call send_sms_via_sns.

8. ALWAYS call write_activity after the send attempt to log the outcome,
   whether it succeeded or failed.

## Writing quality rules

- Open with a specific observation about the contact's company or role — never
  a generic greeting. Use data from enrichment_context.personalisation_hints.
- Keep emails under 150 words. Recipients are busy.
- One clear call-to-action per message. Do not ask multiple questions.
- Match the brand_voice_profile exactly — do not deviate from the tone.
- Subject line: max 60 chars, no ALL CAPS, no exclamation marks.
- Never make claims about product capabilities that aren't in the brand voice
  profile or campaign goal template.

## Output format

When done, respond with JSON:
{
  "channel": "email|sms",
  "sent": true|false,
  "messageId": "<id or null>",
  "activityId": "<id>",
  "pausedReason": "<str or null>",
  "complianceIssues": []
}
""".strip()

MODEL = os.environ.get("OUTREACH_MODEL", "global.amazon.nova-2-lite-v1:0")


def run(event: dict) -> dict:
    """
    Entry point invoked by:
    - Step Functions (DraftEmail, SendEmail states)
    - Coordinator agent (direct delegation)

    Expected event:
      {tenantId, contactId, campaignId, channel, toEmail?, toPhone?,
       approvalMode?, hasConsent, configurationSet?}
    """
    agent = Agent(
        model=build_model(MODEL),
        system_prompt=SYSTEM_PROMPT,
        tools=[
            get_previous_touches,
            get_enrichment_context,
            get_brand_voice_profile,
            validate_email_compliance,
            validate_sms_compliance,
            check_send_pause,
            create_approval_draft,
            send_email_via_ses,
            send_sms_via_sns,
            write_activity,
        ],
    )

    tenant_id     = event.get("tenantId", "")
    contact_id    = event.get("contactId", "")
    campaign_id   = event.get("campaignId", "")
    channel       = event.get("channel", "email")
    approval_mode = event.get("approvalMode", "auto_send")
    has_consent   = event.get("hasConsent", False)
    to_email      = event.get("toEmail", "")
    to_phone      = event.get("toPhone", "")
    config_set    = event.get("configurationSet", os.environ.get("SES_CONFIGURATION_SET", "impulsoiq-dev"))
    approval      = event.get("approval") if isinstance(event.get("approval"), dict) else {}

    if not has_consent:
        # This should never happen — SFN consent gate fires before this agent.
        # Belt-and-suspenders guard.
        return {
            "channel": channel,
            "sent":    False,
            "error":   "Consent not granted — outreach agent should not have been invoked without consent",
        }

    approved_body = approval.get("body") or event.get("approvedBody")
    approved_subject = approval.get("subject") or event.get("approvedSubject")
    human_approved = bool(approved_body) and not approval.get("auto")
    allow_unverified = bool(approval.get("allowUnverifiedEmail"))

    pause = check_send_pause(tenant_id)
    if pause.get("paused"):
        return {
            "channel": channel,
            "sent": False,
            "error": "send_paused",
            "pausedReason": pause.get("reason"),
        }

    prompt = (
        f"Send a personalised {channel} outreach message.\n"
        f"Tenant ID:      {tenant_id}\n"
        f"Contact ID:     {contact_id}\n"
        f"Campaign ID:    {campaign_id}\n"
        f"Channel:        {channel}\n"
        f"To email:       {to_email}\n"
        f"To phone:       {to_phone}\n"
        f"Approval mode:  {approval_mode}\n"
        f"Has consent:    {has_consent}\n"
        f"Config set:     {config_set}\n"
        f"allow_unverified on send_email_via_ses must be {str(allow_unverified).lower()}.\n\n"
        + (
          "A human approved this exact copy. Send it via send_email_via_ses without rewriting:\n"
          f"Subject: {approved_subject}\nBody:\n{approved_body}\n"
          if human_approved else
          "Follow your pre-flight checklist exactly. Compliance is non-negotiable.\n"
        )
    )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "contactId": contact_id}
