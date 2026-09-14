"""
Clarification Agent — turns an ambiguous goal into a fully-specified one.

Settled preferences come from AgentCore Memory. Missing Memory in production
returns missing keys — it does not silently enable calls.
"""
import json
import os
import boto3
from strands import Agent, tool
from impulsoiq_model import build_model

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))

# Keys that would auto-enable outbound if defaulted. Never fill these from code.
NO_SILENT_DEFAULT = {
    "default_outreach_channels",
}


def _memory_client():
    return boto3.client("bedrock-agentcore", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _namespace(tenant_id: str) -> str:
    return f"/impulsoiq/{tenant_id}/preferences"


@tool
def query_settled_preferences(tenant_id: str, preference_keys: list) -> dict:
    """
    Retrieve settled tenant/user preferences from AgentCore Memory.
    Returns {preferences: {key: value}, missing: [keys], source: str}.

    If Memory is unset or empty, missing lists every requested key that would
    change outbound behaviour. require_approval_before_send defaults to True
    only as a conservative fallback, never as a permission to call.
    """
    keys = list(preference_keys or [])
    found: dict = {}
    missing: list = []
    memory_id = os.environ.get("MEMORY_STORE_ID", "")

    if not memory_id:
        conservative = {"require_approval_before_send": True}
        for k in keys:
            if k in conservative:
                found[k] = conservative[k]
            else:
                missing.append(k)
        return {"preferences": found, "missing": missing, "source": "memory_unset"}

    try:
        client = _memory_client()
        for key in keys:
            resp = client.retrieve_memory_records(
                memoryId=memory_id,
                namespace=_namespace(tenant_id),
                searchCriteria={"searchQuery": str(key), "topK": 3},
            )
            records = resp.get("memoryRecordSummaries") or resp.get("memoryRecords") or []
            value = None
            for rec in records:
                content = rec.get("content") or rec.get("memoryRecord", {}).get("content") or {}
                text = content.get("text") or content.get("value")
                if not text:
                    continue
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict) and key in parsed:
                        value = parsed[key]
                    elif isinstance(parsed, dict) and "value" in parsed:
                        value = parsed["value"]
                    else:
                        value = parsed
                except json.JSONDecodeError:
                    value = text
                break
            if value is None:
                missing.append(key)
            else:
                found[key] = value
    except Exception as exc:
        conservative = {"require_approval_before_send": True}
        found = {k: conservative[k] for k in keys if k in conservative}
        missing = [k for k in keys if k not in found]
        return {
            "preferences": found,
            "missing": missing,
            "source": "memory_error",
            "error": str(exc),
        }

    # Never invent channel lists that include voice/email from code defaults.
    for k in list(found):
        if k in NO_SILENT_DEFAULT and found[k] is None:
            del found[k]
            missing.append(k)

    return {"preferences": found, "missing": missing, "source": "agentcore_memory"}


@tool
def get_contact_summary(tenant_id: str, contact_id: str) -> dict:
    """
    Retrieve a contact's current stage, last activity, and enrichment summary
    from the CRM to inform clarification questions.
    """
    crm_read = os.environ.get("CRM_READ_SERVICE_ARN") or os.environ.get("CRM_READ_ARN", "")
    resp = _lambda.invoke(
        FunctionName   = crm_read,
        InvocationType = "RequestResponse",
        Payload        = json.dumps({
            "operation": "get_contact",
            "payload":   {"id": contact_id},
            "tenantId":  tenant_id,
        }).encode(),
    )
    return json.loads(resp["Payload"].read()) if resp.get("Payload") else {}


@tool
def emit_specified_goal(
    tenant_id: str,
    original_goal: str,
    resolved_goal: str,
    parameters: dict,
) -> dict:
    """
    Emit the fully-specified goal back to the caller.
    Call only when all required parameters are resolved (memory or user answers).
    """
    return {
        "status":         "clarification_complete",
        "tenantId":       tenant_id,
        "originalGoal":   original_goal,
        "resolvedGoal":   resolved_goal,
        "parameters":     parameters,
    }


SYSTEM_PROMPT = """
You are the ImpulsoIQ Clarification Agent. Your job is to turn an ambiguous
campaign goal into a fully-specified one that the Coordinator can execute without
further questions.

## Process (strictly in this order)
1. Call query_settled_preferences to retrieve what is already known.
   Ask ONLY about preferences that are NOT in memory and NOT inferable.
   If a key is in `missing`, you MUST ask — do not invent channels or call permission.
2. If the contact_id is provided, call get_contact_summary to understand context.
3. Ask the minimum number of questions necessary.
4. When all parameters are resolved, call emit_specified_goal.

## Parameters you must resolve before emitting
- channels: which outreach channels are approved (email, sms, call)
- approval_mode: how much human oversight is required
- max_touches: upper bound on contact attempts
- goal_type: what the campaign is trying to achieve

## What you must NOT ask about
- Information already in query_settled_preferences.preferences
- Technical settings (webhook URLs, infrastructure configuration)

Never assume voice/call is allowed unless it appears in settled preferences or
the user explicitly chose it in this session.
""".strip()

MODEL = os.environ.get("CLARIFICATION_MODEL", "global.amazon.nova-2-lite-v1:0")


def run(event: dict) -> dict:
    agent = Agent(
        model         = build_model(MODEL),
        system_prompt = SYSTEM_PROMPT,
        tools         = [query_settled_preferences, get_contact_summary, emit_specified_goal],
    )

    prompt = (
        f"Clarify this goal before execution.\n"
        f"Tenant: {event.get('tenantId')}\n"
        f"Goal: {event.get('goal', '')}\n"
        f"Contact: {event.get('contactId', 'not specified')}\n"
    )

    result = agent(prompt)
    return {"result": str(result), "event": event}
