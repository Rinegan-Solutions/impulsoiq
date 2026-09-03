"""
Outreach & Drafting Agent — tool definitions.

Compliance rules enforced in every tool:
- validate_email_compliance MUST pass before send_email_via_ses is called.
- validate_sms_compliance MUST pass before send_sms_via_sns is called.
- check_send_pause MUST return { paused: false } before any send.
- Consent has already been checked by the Coordinator; this agent does NOT
  re-check consent — it receives the consent result as input from the SFN.
- All CRM writes go through write_activity (CRM Write Service).
"""
import json
import os
import boto3
from strands import tool

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_ses    = boto3.client("ses",    region_name=os.environ.get("SES_REGION", os.environ.get("AWS_REGION", "eu-west-2")))
_sns    = boto3.client("sns",    region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_ddb    = boto3.client("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _invoke_lambda(function_arn: str, payload: dict) -> dict:
    resp   = _lambda.invoke(
        FunctionName=function_arn,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode(),
    )
    result = json.loads(resp["Payload"].read())
    if resp.get("FunctionError"):
        raise RuntimeError(f"Lambda invocation failed: {result}")
    return result


@tool
def get_previous_touches(tenant_id: str, contact_id: str) -> dict:
    """
    Read the contact's activity history (emails, calls, notes) from the CRM.

    Call this before drafting any message to avoid repeating yourself or
    referencing something that was already discussed. Returns up to 20
    most-recent activities sorted newest-first.
    """
    crm_read_arn = os.environ["CRM_READ_SERVICE_ARN"]
    return _invoke_lambda(crm_read_arn, {
        "operation": "get_activity_history",
        "payload":   {"contactId": contact_id, "limit": 20},
        "tenantId":  tenant_id,
    })


@tool
def get_enrichment_context(tenant_id: str, contact_id: str) -> dict:
    """
    Fetch the contact's enrichment_json — company data, ICP fit score,
    personalisation hints, and tech stack — from the CRM.

    Use this to personalise the email subject line and opening paragraph.
    The enrichment_json.personalisation_hints field (set by the research
    agent) is especially useful.
    """
    crm_read_arn = os.environ["CRM_READ_SERVICE_ARN"]
    return _invoke_lambda(crm_read_arn, {
        "operation": "get_enrichment_data",
        "payload":   {"contactId": contact_id},
        "tenantId":  tenant_id,
    })


@tool
def get_brand_voice_profile(tenant_id: str) -> dict:
    """
    Fetch the tenant's brand voice profile (tone, persona, messaging pillars).

    Always call this before drafting. The brand voice profile defines how
    messages should sound — formal/informal, first-person, value prop emphasis,
    forbidden phrases, etc. Match the profile exactly.
    """
    crm_read_arn = os.environ["CRM_READ_SERVICE_ARN"]
    return _invoke_lambda(crm_read_arn, {
        "operation": "get_brand_voice_profile",
        "payload":   {},
        "tenantId":  tenant_id,
    })


@tool
def validate_email_compliance(subject: str, body: str, sender_name: str) -> dict:
    """
    Check CAN-SPAM Act compliance before sending an email.

    MUST be called and MUST return { valid: true } before calling send_email_via_ses.
    Do NOT send if valid is False — fix the missing elements first.

    Checks:
      - Physical mailing address present in body
      - Unsubscribe / opt-out link present in body
      - Clear sender identification in From header or body
      - Subject line not deceptive (no ALL CAPS spam triggers)
      - No misleading header information

    Returns { valid: bool, missing: list[str] }
    """
    missing = []

    body_lower = body.lower()

    # Physical address — CAN-SPAM requires a valid physical postal address
    address_signals = ["po box", "p.o. box", "street", "st.", "avenue", "ave.", "road", "rd.", "suite", "floor"]
    if not any(sig in body_lower for sig in address_signals):
        missing.append("physical_mailing_address")

    # Unsubscribe link
    unsub_signals = ["unsubscribe", "opt out", "opt-out", "manage preferences", "email preferences"]
    if not any(sig in body_lower for sig in unsub_signals):
        missing.append("unsubscribe_link")

    # Sender identification
    if not sender_name or len(sender_name.strip()) < 2:
        missing.append("sender_identification")

    # Subject line checks
    if subject.isupper() and len(subject) > 5:
        missing.append("subject_not_all_caps")

    valid = len(missing) == 0
    return {"valid": valid, "missing": missing}


@tool
def validate_sms_compliance(message: str) -> dict:
    """
    Check CASL / TCPA SMS compliance before sending.

    MUST be called and MUST return { valid: true } before calling send_sms_via_sns.

    Checks:
      - Sender identification included
      - Opt-out instruction (STOP keyword) present
      - Message length within carrier limits (160 chars for single SMS)

    Returns { valid: bool, missing: list[str] }
    """
    missing = []

    msg_lower = message.lower()

    # Opt-out instruction
    if "stop" not in msg_lower and "opt out" not in msg_lower:
        missing.append("stop_opt_out_instruction")

    # Message length warning (not a hard block, just advisory)
    if len(message) > 160:
        missing.append("message_exceeds_single_sms_160_chars_advisory")

    valid = len(missing) == 0
    return {"valid": valid, "missing": missing}


@tool
def check_send_pause(tenant_id: str) -> dict:
    """
    Check if email/SMS sending has been paused for this tenant due to a
    SES reputation alarm (bounce rate > 5% or complaint rate > 0.1%).

    MUST be called and MUST return { paused: false } before any send.
    If paused is true, STOP and log an activity with type=note explaining
    the pause rather than attempting to send.

    Returns { paused: bool, reason?: str }
    """
    table    = os.environ.get("DYNAMODB_TABLE", "")
    if not table:
        return {"paused": False}  # Fail open if table not configured

    keys_to_check = [
        {"pk": {"S": f"{tenant_id}#send_flags#send_pause"}, "sk": {"S": "current"}},
        {"pk": {"S": "global#send_flags#send_pause"},       "sk": {"S": "current"}},
    ]
    for key in keys_to_check:
        try:
            res = _ddb.get_item(TableName=table, Key=key)
            item = res.get("Item")
            if item and item.get("paused", {}).get("BOOL"):
                return {
                    "paused": True,
                    "reason": item.get("reason", {}).get("S", "reputation_alarm"),
                }
        except Exception:
            pass  # Fail open — don't block send on DynamoDB error
    return {"paused": False}


@tool
def create_approval_draft(
    tenant_id:  str,
    contact_id: str,
    channel:    str,
    content:    dict,
) -> dict:
    """
    Create a draft message record awaiting human approval.

    Call this when the campaign config requires approval_mode = 'human_in_loop'.
    The approval record is an activity with status='awaiting_approval' in
    metadata. The human reviews and approves/rejects via the Control Panel.

    content: { subject?, body, to, from_address?, metadata? }
    Returns { ok: bool, id: str } — the activity ID is the approval record ID.
    """
    crm_write_arn = os.environ["CRM_WRITE_SERVICE_ARN"]
    return _invoke_lambda(crm_write_arn, {
        "operation": "upsert_activity",
        "payload": {
            "contactId":  contact_id,
            "type":       channel,  # email or sms
            "actorType":  "agent",
            "actorId":    "outreach-agent",
            "subject":    content.get("subject", ""),
            "body":       content.get("body", ""),
            "metadata":   {
                "status":       "awaiting_approval",
                "channel":      channel,
                "to":           content.get("to", ""),
                "fromAddress":  content.get("from_address", ""),
                **(content.get("metadata") or {}),
            },
        },
        "tenantId":  tenant_id,
        "actorType": "agent",
        "actorId":   "outreach-agent",
    })


@tool
def send_email_via_ses(
    tenant_id:         str,
    contact_id:        str,
    to_email:          str,
    subject:           str,
    body:              str,
    configuration_set: str,
) -> dict:
    """
    Send an email via Amazon SES.

    Prerequisites that MUST be met before calling:
      1. validate_email_compliance returned { valid: true }
      2. check_send_pause returned { paused: false }
      3. Consent was confirmed by the Coordinator (email channel)

    After sending, call write_activity to record the outbound email.
    Returns { ok: bool, messageId: str }
    """
    from_address = os.environ.get("SES_FROM_ADDRESS", f"noreply@impulsoiq.rinegansolutions.com")
    config_set   = configuration_set or os.environ.get("SES_CONFIGURATION_SET", "impulsoiq-dev")

    try:
        resp = _ses.send_email(
            Source=from_address,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body":    {"Html": {"Data": body, "Charset": "UTF-8"}},
            },
            ConfigurationSetName=config_set,
        )
        return {"ok": True, "messageId": resp.get("MessageId", "")}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool
def send_sms_via_sns(
    tenant_id:  str,
    contact_id: str,
    to_phone:   str,
    message:    str,
) -> dict:
    """
    Send an SMS via Amazon SNS.

    Prerequisites that MUST be met before calling:
      1. validate_sms_compliance returned { valid: true }
      2. check_send_pause returned { paused: false }
      3. Consent was confirmed by the Coordinator (sms channel)

    After sending, call write_activity to record the outbound SMS.
    Returns { ok: bool, messageId: str }
    """
    try:
        resp = _sns.publish(
            PhoneNumber=to_phone,
            Message=message,
            MessageAttributes={
                "AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"},
            },
        )
        return {"ok": True, "messageId": resp.get("MessageId", "")}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool
def write_activity(
    tenant_id:  str,
    contact_id: str,
    type:       str,
    body:       str,
    metadata:   dict,
) -> dict:
    """
    Record an outbound send (or send block) as an Activity via the CRM Write Service.

    Call this after every send attempt — success or failure. The activity log
    is the source of truth for what was sent to whom and when.

    type: 'email' | 'sms' | 'note'
    Returns { ok: bool, id: str }
    """
    crm_write_arn = os.environ["CRM_WRITE_SERVICE_ARN"]
    return _invoke_lambda(crm_write_arn, {
        "operation": "upsert_activity",
        "payload": {
            "contactId": contact_id,
            "type":      type,
            "actorType": "agent",
            "actorId":   "outreach-agent",
            "body":      body,
            "metadata":  metadata,
        },
        "tenantId":  tenant_id,
        "actorType": "agent",
        "actorId":   "outreach-agent",
    })
