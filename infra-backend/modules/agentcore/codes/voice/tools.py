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
- check_dnc_registry MUST be called before placing a call (stub in Phase 2).
- place_call_via_calle stores the taskToken — this is how async resumption works.
- write_call_result is called by ProcessCallResult state, not by this agent directly.
"""
import json
import os
import time
import httpx
import boto3
from strands import tool

_lambda = boto3.client("lambda",   region_name=os.environ.get("AWS_REGION", "eu-west-2"))
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

    Phase 2 stub — logs the check and returns allowed=true for all numbers.
    Phase 3: integrate with Neustar / Telnyx DNC scrubbing API.

    Returns { allowed: bool, reason?: str }
    """
    # Phase 2 stub — real DNC scrubbing in Phase 3
    print(f"DNC check (stub): {phone_number} country={country}")
    return {"allowed": True, "source": "stub_phase2"}


@tool
def place_call_via_calle(
    tenant_id:       str,
    contact_id:      str,
    to_phone:        str,
    call_goal:       str,
    result_schema:   dict,
    task_token:      str,
    idempotency_key: str,
) -> dict:
    """
    Place an outbound voice call via the CALL-E API.

    THIS CALL IS ASYNC. The agent returns immediately after calling this tool.
    Do NOT wait for a call result — it will arrive via webhook.

    The task_token (from Step Functions .waitForTaskToken) is stored in DynamoDB
    so the webhook-handler Lambda can resume the SFN execution when CALL-E
    sends the CallCompleted webhook.

    Args:
        tenant_id:       Tenant identifier for isolation
        contact_id:      Contact being called
        to_phone:        E.164 format phone number
        call_goal:       'qualification' | 'meeting_confirmation' | 'follow_up'
        result_schema:   JSON schema describing what CALL-E should extract
        task_token:      Step Functions task token from the event
        idempotency_key: Unique key for deduplication

    Returns { callId: str, status: 'initiated' }
    """
    calle_base_url = os.environ.get("CALLE_BASE_URL", "")
    calle_api_key  = os.environ.get("CALLE_API_KEY", "")
    table          = os.environ.get("DYNAMODB_TABLE", "")

    # Store taskToken in DynamoDB BEFORE placing the call (idempotency)
    if table and task_token:
        _ddb.put_item(
            TableName=table,
            Item={
                "pk":             {"S": f"{tenant_id}#call_tasks#{idempotency_key}"},
                "sk":             {"S": "task_token"},
                "taskToken":      {"S": task_token},
                "tenantId":       {"S": tenant_id},
                "contactId":      {"S": contact_id},
                "idempotencyKey": {"S": idempotency_key},
                "createdAt":      {"S": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                "ttl":            {"N": str(int(time.time()) + 86400 * 3)},  # 3-day TTL
            },
            ConditionExpression="attribute_not_exists(pk)",  # idempotency guard
        )

    if not calle_base_url or not calle_api_key:
        # Stub for local development / testing
        print(f"CALL-E stub: would call {to_phone} for {call_goal}. idempotencyKey={idempotency_key}")
        return {"callId": f"stub-{idempotency_key}", "status": "initiated", "source": "stub"}

    try:
        resp = httpx.post(
            f"{calle_base_url}/calls",
            headers={
                "Authorization": f"Bearer {calle_api_key}",
                "Content-Type":  "application/json",
                "Idempotency-Key": idempotency_key,
            },
            json={
                "to":             to_phone,
                "goal":           call_goal,
                "result_schema":  result_schema,
                "webhook_url":    os.environ.get("CALLE_WEBHOOK_URL", ""),
                "metadata": {
                    "tenantId":      tenant_id,
                    "contactId":     contact_id,
                    "idempotencyKey": idempotency_key,
                },
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return {"callId": data.get("id", ""), "status": data.get("status", "initiated")}
    except Exception as exc:
        raise RuntimeError(f"CALL-E API error: {exc}") from exc


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
