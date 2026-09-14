"""
Voice Agent — tool definitions.

CALL-E integration is wrapped behind VoiceProvider so the agent is
not coupled to a specific vendor.

Async call lifecycle (CRITICAL — read carefully):
  1. place_call_via_calle() fires the call and stores the taskToken in DynamoDB.
  2. The agent RETURNS IMMEDIATELY after placing the call.
  3. CALL-E completes the call and sends a CallCompleted webhook.
  4. webhook-handler Lambda reads the taskToken from DynamoDB.
  5. webhook-handler calls sfn.SendTaskSuccess to resume the SFN graph.
  6. SFN routes to ProcessCallResult which invokes write_call_result.

Rules:
- validate_calling_window MUST pass before placing a call.
- check_dnc_registry MUST be called before placing a call (fail closed).
- place_call_via_calle stores the taskToken — this is how async resumption works.
- write_call_result is called by ProcessCallResult state, not by this agent directly.
"""
import json
import os
import boto3
# Aliased: place_call_via_calle takes a `timezone` STRING parameter (the
# contact's IANA zone), which shadows a bare `timezone` import inside that
# function. Importing under a distinct name keeps datetime.timezone.utc
# reachable there.
from datetime import datetime, timezone as dt_timezone
from strands import tool
from .provider import AI_DISCLOSURE, check_dnc, get_provider, store_call_task

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


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
def get_contact_context(tenant_id: str, contact_id: str) -> dict:
    """
    Fetch the contact's profile and enrichment data to build a personalised
    call script.

    Call this first to understand who you're calling: name, company, role,
    previous touches, and any personalisation hints from the research agent.
    Returns { contact, enrichment_json, activities }.
    """
    crm_read_arn = os.environ["CRM_READ_SERVICE_ARN"]
    contact = _invoke_lambda(crm_read_arn, {
        "operation": "get_contact",
        "payload":   {"id": contact_id},
        "tenantId":  tenant_id,
    })
    enrichment = _invoke_lambda(crm_read_arn, {
        "operation": "get_enrichment_data",
        "payload":   {"contactId": contact_id},
        "tenantId":  tenant_id,
    })
    activities = _invoke_lambda(crm_read_arn, {
        "operation": "get_activity_history",
        "payload":   {"contactId": contact_id, "limit": 5},
        "tenantId":  tenant_id,
    })
    return {
        "contact":        contact.get("result"),
        "enrichment_json": enrichment.get("result"),
        "activities":     activities.get("result", []),
    }


@tool
def validate_calling_window(timezone: str, contact_country: str) -> dict:
    """
    Check if the current time is within the legally allowed calling window
    for the contact's location (8:00 AM – 8:00 PM local time).

    MUST be called and MUST return { allowed: true } before placing any call.
    If allowed is False, do NOT place the call. Log a note activity instead
    and let the SFN move to the next step.

    Returns { allowed: bool, localTime: str, reason?: str }
    """
    import datetime

    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(timezone or "UTC")
    except Exception:
        tz = datetime.timezone.utc

    local_now  = datetime.datetime.now(tz)
    local_hour = local_now.hour

    # TCPA / CASL / UK ICO: 8am–8pm local time for outbound calls
    if 8 <= local_hour < 20:
        return {
            "allowed":   True,
            "localTime": local_now.strftime("%H:%M"),
            "timezone":  timezone,
        }
    else:
        return {
            "allowed":   False,
            "localTime": local_now.strftime("%H:%M"),
            "timezone":  timezone,
            "reason":    f"Outside allowed calling window (8:00–20:00 local). Current local time: {local_now.strftime('%H:%M')}",
        }


@tool
def check_dnc_registry(phone_number: str, country: str) -> dict:
    """
    Check if the phone number is on a Do Not Call registry.

    Fail closed: without a DNC provider, only numbers on DNC_TEST_NUMBERS
    (internal E.164 allowlist) are permitted. Tenant-imported lists cannot
    bypass this check.

    Returns { allowed: bool, reason?: str, source: str }
    """
    return check_dnc(phone_number, country)


@tool
def place_call_via_calle(
    tenant_id:       str,
    contact_id:      str,
    to_phone:        str,
    call_goal:       str,
    result_schema:   dict,
    task_token:      str,
    idempotency_key: str,
    agent_run_id:    str = "",
    timezone:        str = "UTC",
    contact_country: str = "",
    contact_first_name: str = "",
) -> dict:
    """
    Place an outbound voice call via the VoiceProvider (CALL-E).

    THIS CALL IS ASYNC. The agent returns immediately after calling this tool.
    Do NOT wait for a call result — it will arrive via webhook.

    The first spoken sentence is an EU AI Act Article 50 disclosure plus a
    TCPA recording-consent prompt. Missing CALL-E credentials in production
    refuse the call.

    Returns { callId: str, status: 'initiated' } or a blocked payload.
    """
    crm_read_arn = os.environ.get("CRM_READ_SERVICE_ARN", "")
    if crm_read_arn:
        tenant = _invoke_lambda(crm_read_arn, {
            "operation": "get_tenant",
            "payload": {},
            "tenantId": tenant_id,
        })
        row = tenant.get("result") or {}
        if str(row.get("tier") or "free") == "free":
            return {
                "callInitiated": False,
                "blocked": True,
                "paywall": True,
                "reason": "Voice is not included on the Free plan. Upgrade to Starter to place calls.",
            }

    table = os.environ.get("DYNAMODB_TABLE", "")
    window = validate_calling_window(timezone, contact_country)
    dnc = check_dnc(to_phone, contact_country)
    if not window.get("allowed"):
        return {"callInitiated": False, "blocked": True, "reason": window.get("reason"), "callingWindow": window, "dnc": dnc}
    if not dnc.get("allowed"):
        return {"callInitiated": False, "blocked": True, "reason": dnc.get("reason"), "callingWindow": window, "dnc": dnc}

    provider = get_provider()
    plan = provider.plan(
        call_goal=call_goal,
        contact={"first_name": contact_first_name},
        disclosure_text=AI_DISCLOSURE,
    )
    schema = result_schema or plan["resultSchema"]
    disclosure_at = datetime.now(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    placed = provider.run(
        to_phone=to_phone,
        call_goal=call_goal,
        result_schema=schema,
        webhook_url=os.environ.get("CALLE_WEBHOOK_URL", ""),
        metadata={
            "tenantId": tenant_id,
            "contactId": contact_id,
            "agentRunId": agent_run_id,
            "idempotencyKey": idempotency_key,
            "aiDisclosureText": AI_DISCLOSURE,
        },
        opening=plan["opening"],
        idempotency_key=idempotency_key,
    )

    if table and task_token:
        try:
            store_call_task(
                table=table,
                tenant_id=tenant_id,
                contact_id=contact_id,
                agent_run_id=agent_run_id,
                task_token=task_token,
                idempotency_key=idempotency_key,
                call_id=placed.get("callId", ""),
                disclosure_text=AI_DISCLOSURE,
                disclosure_at=disclosure_at,
                calling_window=window,
                dnc_result=dnc,
            )
        except Exception as exc:
            # ConditionalCheckFailed means this idempotency key already fired.
            if "ConditionalCheckFailed" not in str(exc):
                raise

    return {
        "callId": placed.get("callId", ""),
        "status": placed.get("status", "initiated"),
        "source": placed.get("source"),
        "aiDisclosureDeliveredAt": disclosure_at,
        "aiDisclosureText": AI_DISCLOSURE,
        "callingWindow": window,
        "dnc": dnc,
    }


@tool
def cancel_in_flight_call(call_id: str) -> dict:
    """Best-effort cancel of an in-flight CALL-E call. May return cancelled=false."""
    return get_provider().cancel(call_id=call_id)


@tool
def write_call_result(
    tenant_id:        str,
    agent_run_id:     str,
    contact_id:       str,
    call_id:          str,
    outcome:          str,
    duration_seconds: int,
    transcript_s3_key: str,
    summary_json:     dict,
    idempotency_key:  str,
) -> dict:
    """
    Persist the call result to Aurora DSQL via the CRM Write Service.

    Called by the ProcessCallResult Step Functions state AFTER the call completes
    and the SFN execution resumes. Uses idempotency_key for deduplication.

    outcome: 'answered' | 'voicemail' | 'no_answer' | 'busy' | 'failed'
    Returns { ok: bool, id: str }
    """
    crm_write_arn = os.environ["CRM_WRITE_SERVICE_ARN"]
    return _invoke_lambda(crm_write_arn, {
        "operation": "upsert_call_result",
        "payload": {
            "agentRunId":       agent_run_id,
            "contactId":        contact_id,
            "callId":           call_id,
            "idempotencyKey":   idempotency_key,
            "outcome":          outcome,
            "durationSeconds":  duration_seconds,
            "transcriptS3Key":  transcript_s3_key,
            "summaryJson":      summary_json,
            "aiDisclosureText": AI_DISCLOSURE,
        },
        "tenantId":  tenant_id,
        "actorType": "agent",
        "actorId":   "voice-agent",
    })


@tool
def write_activity(
    tenant_id:   str,
    contact_id:  str,
    agent_run_id: str,
    body:        str,
    metadata:    dict,
) -> dict:
    """
    Record a call activity (or a blocked-call note) via the CRM Write Service.

    Call this when:
    - The call was placed successfully (type='call', metadata.callId=...)
    - The call was blocked due to calling window / DNC (type='note')
    - Any other noteworthy event during the voice workflow

    Returns { ok: bool, id: str }
    """
    crm_write_arn = os.environ["CRM_WRITE_SERVICE_ARN"]
    return _invoke_lambda(crm_write_arn, {
        "operation": "upsert_activity",
        "payload": {
            "contactId":  contact_id,
            "agentRunId": agent_run_id,
            "type":       metadata.get("type", "call"),
            "actorType":  "agent",
            "actorId":    "voice-agent",
            "body":       body,
            "metadata":   metadata,
        },
        "tenantId":  tenant_id,
        "actorType": "agent",
        "actorId":   "voice-agent",
    })
