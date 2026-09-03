"""
Nurture & Follow-up Agent — tool definitions.

Manages the post-first-touch nurture cadence. Decides whether to
send another email, escalate to a voice call, or mark the contact
as do-not-contact based on engagement signals and consent status.

Rules:
- decide_next_action is deterministic — it evaluates rules, not LLM guessing.
- All cadence state writes go through update_cadence_memory.
- All CRM writes go through write_crm_record (CRM Write Service).
- Consent channels available must be checked before choosing an action channel.
"""
import json
import os
import time
import boto3
from strands import tool

_lambda  = boto3.client("lambda",   region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_ddb     = boto3.client("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_events  = boto3.client("events",   region_name=os.environ.get("AWS_REGION", "eu-west-2"))


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
def get_contact_engagement(tenant_id: str, contact_id: str) -> dict:
    """
    Read the contact's recent activity history — emails, opens, replies, calls.

    Use engagement signals (email opened, replied, link clicked) to decide
    whether the contact is warming up or going cold.

    Returns { activities: list, lastActivityAt: str, activityCount: int }
    """
    crm_read_arn = os.environ["CRM_READ_SERVICE_ARN"]
    result = _invoke_lambda(crm_read_arn, {
        "operation": "get_activity_history",
        "payload":   {"contactId": contact_id, "limit": 20},
        "tenantId":  tenant_id,
    })
    activities = result.get("result", [])
    last_at    = activities[0].get("occurred_at") if activities else None
    return {
        "activities":      activities,
        "lastActivityAt":  last_at,
        "activityCount":   len(activities),
    }


@tool
def get_contact_cadence_memory(tenant_id: str, contact_id: str) -> dict:
    """
    Read the contact's cadence state from DynamoDB.

    The cadence state tracks: last touch type, touch count, next planned
    action, and wait days. This prevents over-contacting and ensures the
    nurture sequence progresses correctly.

    Returns { lastTouchType, touchCount, nextAction, waitDays, lastUpdatedAt }
    or {} if no cadence state exists (first touch).
    """
    table = os.environ.get("DYNAMODB_TABLE", "")
    if not table:
        return {}
    try:
        res = _ddb.get_item(
            TableName=table,
            Key={
                "pk": {"S": f"{tenant_id}#cadence#{contact_id}"},
                "sk": {"S": "state"},
            },
        )
        item = res.get("Item")
        if not item:
            return {}
        return {
            "lastTouchType": item.get("lastTouchType", {}).get("S", ""),
            "touchCount":    int(item.get("touchCount", {}).get("N", "0")),
            "nextAction":    item.get("nextAction", {}).get("S", ""),
            "waitDays":      int(item.get("waitDays", {}).get("N", "3")),
            "lastUpdatedAt": item.get("lastUpdatedAt", {}).get("S", ""),
        }
    except Exception as exc:
        print(f"get_contact_cadence_memory error: {exc}")
        return {}


@tool
def update_cadence_memory(
    tenant_id:       str,
    contact_id:      str,
    last_touch_type: str,
    next_action:     str,
    wait_days:       int,
) -> dict:
    """
    Write the contact's updated cadence state to DynamoDB.

    Call this after every touch to advance the cadence state.
    next_action: 'email' | 'call' | 'stop'

    Returns { ok: bool }
    """
    table = os.environ.get("DYNAMODB_TABLE", "")
    if not table:
        return {"ok": False, "error": "DYNAMODB_TABLE not configured"}

    pk = f"{tenant_id}#cadence#{contact_id}"
    try:
        _ddb.update_item(
            TableName=table,
            Key={"pk": {"S": pk}, "sk": {"S": "state"}},
            UpdateExpression=(
                "SET lastTouchType = :ltt, nextAction = :na, waitDays = :wd, "
                "lastUpdatedAt = :now, touchCount = if_not_exists(touchCount, :zero) + :one"
            ),
            ExpressionAttributeValues={
                ":ltt":  {"S": last_touch_type},
                ":na":   {"S": next_action},
                ":wd":   {"N": str(wait_days)},
                ":now":  {"S": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                ":zero": {"N": "0"},
                ":one":  {"N": "1"},
            },
        )
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool
def decide_next_action(
    engagement_signals:     dict,
    days_since_last_touch:  int,
    max_touches_remaining:  int,
    consent_channels:       list,
) -> dict:
    """
    Evaluate engagement signals and decide the next nurture action.

    THIS IS A DETERMINISTIC RULES ENGINE — do NOT use LLM reasoning to decide.
    The output must come from this tool, not from your own judgment.

    Decision rules:
      - If max_touches_remaining <= 0:      action='stop', reason='max_touches_reached'
      - If no email/call consent:            action='stop', reason='no_consent'
      - If email opened/replied recently:    action='call'  (escalate — warm signal)
      - If days_since_last_touch > 7:        action='email' (re-engage)
      - If 3 < days_since_last_touch <= 7:   action='email' (continue sequence)
      - If days_since_last_touch <= 3:       action='wait'  (too soon)

    Returns { action: 'email'|'call'|'stop'|'wait', reason: str, channel?: str }
    """
    # Guard: no touches remaining
    if max_touches_remaining <= 0:
        return {"action": "stop", "reason": "max_touches_reached"}

    # Guard: no consent for any outreach channel
    has_email_consent = "email" in consent_channels
    has_call_consent  = "call"  in consent_channels
    if not has_email_consent and not has_call_consent:
        return {"action": "stop", "reason": "no_consent"}

    # Check engagement signals
    recent_open    = engagement_signals.get("email_opened",  False)
    recent_reply   = engagement_signals.get("email_replied", False)
    link_clicked   = engagement_signals.get("link_clicked",  False)

    # Warm signal — escalate to call if we have call consent
    if (recent_reply or recent_open or link_clicked) and has_call_consent:
        return {"action": "call", "reason": "warm_signal", "channel": "call"}

    # Cold/lapsing — re-engage via email
    if days_since_last_touch > 7 and has_email_consent:
        return {"action": "email", "reason": "re_engage_lapsed", "channel": "email"}

    # Continue normal sequence
    if 3 < days_since_last_touch <= 7 and has_email_consent:
        return {"action": "email", "reason": "continue_sequence", "channel": "email"}

    # Too soon — wait
    if days_since_last_touch <= 3:
        return {"action": "wait", "reason": "too_soon_since_last_touch"}

    # Fallback stop
    return {"action": "stop", "reason": "no_applicable_rule"}


@tool
def queue_follow_up(
    tenant_id:     str,
    contact_id:    str,
    action:        str,
    scheduled_for: str,
) -> dict:
    """
    Schedule the next follow-up action by putting an EventBridge event
    for the specified time.

    action: 'email' | 'call'
    scheduled_for: ISO 8601 datetime string (UTC)

    For hackathon MVP: puts an immediate EventBridge event tagged with the
    scheduled_for time; a downstream consumer re-evaluates at that time.
    Phase 3: use EventBridge Scheduler for precise time-based execution.

    Returns { ok: bool, scheduled_for: str }
    """
    event_bus = os.environ.get("EVENT_BUS_ARN", "")
    if not event_bus:
        return {"ok": False, "error": "EVENT_BUS_ARN not configured"}

    try:
        _events.put_events(
            Entries=[{
                "EventBusName": event_bus,
                "Source":       "impulsoiq.nurture",
                "DetailType":   "FollowUpScheduled",
                "Detail":       json.dumps({
                    "tenantId":     tenant_id,
                    "contactId":    contact_id,
                    "action":       action,
                    "scheduledFor": scheduled_for,
                }),
            }]
        )
        return {"ok": True, "scheduledFor": scheduled_for}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
