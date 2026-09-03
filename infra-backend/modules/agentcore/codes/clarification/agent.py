"""
Clarification Agent — Phase 1.

Turns an ambiguous goal into a fully-specified one before the Coordinator
builds its execution plan. Checks AgentCore Memory for settled preferences
first — asks only what is genuinely unresolved.

Output: a fully-specified goal JSON that the Coordinator consumes directly.
"""
import json
import os
import boto3
from strands import Agent, tool

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


@tool
def query_settled_preferences(tenant_id: str, preference_keys: list) -> dict:
    """
    Retrieve settled tenant/user preferences from AgentCore Memory.
    Returns {preferences: {key: value}} for each key found.

    Examples of settled preferences:
    - default_outreach_channels (["email", "call"])
    - max_touches_per_contact (int)
    - send_window_start_hour (int, in tenant timezone)
    - brand_voice_profile (str)
    """
    # Phase 1: Returns defaults until AgentCore Memory is wired up in Phase 2.
    defaults: dict = {
        "default_outreach_channels": ["email", "call"],
        "max_touches_per_contact":   5,
        "send_window_start_hour":    8,
        "send_window_end_hour":      18,
        "brand_voice_profile":       "professional, concise, consultative",
        "require_approval_before_send": True,
    }
    found = {k: defaults[k] for k in preference_keys if k in defaults}
    return {"preferences": found, "missing": [k for k in preference_keys if k not in defaults]}


@tool
def get_contact_summary(tenant_id: str, contact_id: str) -> dict:
    """
    Retrieve a contact's current stage, last activity, and enrichment summary
    from the CRM to inform clarification questions.
    """
    resp = _lambda.invoke(
        FunctionName   = os.environ.get("CRM_READ_ARN", ""),
        InvocationType = "RequestResponse",
        Payload        = json.dumps({
            "operation": "get_contact",
            "tenantId":  tenant_id,
            "contactId": contact_id,
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
    This tool marks clarification as complete — call it only when all required
    parameters are resolved (either from memory or from user answers).

    The parameters dict must include:
      - channels: list[str]          channels approved for this campaign
      - approval_mode: str           'every_send' | 'first_n' | 'exceptions_only'
      - max_touches: int             maximum outreach attempts per contact
      - goal_type: str               'lead_qualification' | 'meeting_confirmation' | 'nurture'
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
2. If the contact_id is provided, call get_contact_summary to understand context.
3. Ask the minimum number of questions necessary. Use structured prompts:
   - Binary questions get yes/no
   - Multi-choice questions offer 2–4 options
   - Never ask about information the system already has
4. When all parameters are resolved, call emit_specified_goal.

## Parameters you must resolve before emitting
- channels: which outreach channels are approved (email, sms, call)
- approval_mode: how much human oversight is required
- max_touches: upper bound on contact attempts
- goal_type: what the campaign is trying to achieve

## What you must NOT ask about
- Information already in query_settled_preferences response
- The tenant's own company/product (you have the brand_voice_profile)
- Technical settings (webhook URLs, infrastructure configuration)
""".strip()

MODEL = os.environ.get("CLARIFICATION_MODEL", "us.amazon.nova-lite-v1:0")


def run(event: dict) -> dict:
    """
    Entry point.
    Expected event: {tenantId, goal, contactId?, userId?}
    Returns:        {status: 'clarification_complete', resolvedGoal, parameters}
    """
    agent = Agent(
        model         = MODEL,
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
