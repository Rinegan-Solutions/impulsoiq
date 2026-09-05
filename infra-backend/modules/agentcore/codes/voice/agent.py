"""
Voice Agent — Phase 2 (complete implementation).

Initiates outbound AI voice calls via CALL-E and processes call results.

CRITICAL: This agent is ASYNC. It places the call and returns immediately.
It does NOT wait for the call to complete. The Step Functions graph pauses
in the PlaceVoiceCall .waitForTaskToken state. The webhook-handler Lambda
resumes the SFN execution when CALL-E sends the CallCompleted webhook.

HARD GATE: ConsentRecord for 'call' channel must exist before calling.
           The Coordinator checks this; the SFN will not reach PlaceVoiceCall
           if consent is not granted.

ARM64 container; model: Claude Sonnet (configurable via VOICE_MODEL env var).
"""
import json
import os
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    get_contact_context,
    validate_calling_window,
    check_dnc_registry,
    place_call_via_calle,
    write_call_result,
    write_activity,
)

SYSTEM_PROMPT = """
You are the ImpulsoIQ Voice agent. You initiate outbound AI voice calls via
CALL-E on behalf of revenue teams and process call results.

## CRITICAL: This is an asynchronous workflow

When placing a call:
1. Call get_contact_context to build a personalised call brief.
2. Call validate_calling_window. If allowed is False, call write_activity
   with type=note explaining why the call was not placed. STOP.
3. Call check_dnc_registry. If allowed is False, call write_activity with
   type=note explaining the DNC block. STOP.
4. Call place_call_via_calle with the task_token from the event. This
   fires the call and stores the taskToken for webhook resumption.
5. Call write_activity to log that the call was initiated (type='call').
6. RETURN IMMEDIATELY. Do not wait for the call result. The Step Functions
   graph will pause and resume automatically when CALL-E completes the call.

When processing a call result (event contains callResult):
1. Examine the callResult: outcome, durationSeconds, summaryJson.
2. Call write_call_result to persist the structured result to the CRM.
3. Call write_activity to log the call outcome with a human-readable summary.
4. If outcome = 'answered' and summaryJson contains meeting_booked = true,
   note this prominently in the activity for the Coordinator to act on.
5. Return a JSON summary of the call outcome.

## Rules — strictly enforced

- NEVER proceed with a call if validate_calling_window returns allowed = false.
- NEVER proceed with a call if check_dnc_registry returns allowed = false.
- ALWAYS pass the task_token from the event to place_call_via_calle — this
  is how the Step Functions graph resumes after the call completes.
- ALWAYS write an activity record for every call attempt (success or block).
- DO NOT invent call outcomes — only process what arrives in callResult.
- This agent does NOT check consent — the Coordinator's consent gate
  (CheckCallConsent) fires before this agent is invoked.

## call_goal values

- "qualification": Qualify the lead using BANT framework. Extract:
    { budget, authority, need, timeline, interest_level, meeting_booked,
      objections, next_step }
- "meeting_confirmation": Confirm a booked meeting. Extract:
    { confirmed, reschedule_requested, new_time_preference }
- "follow_up": Follow up after email engagement. Extract:
    { interest_level, questions, meeting_booked, objections }

## Output format (call initiation)

{ "callInitiated": true, "callId": "<id>", "activityId": "<id>" }

## Output format (call result processing)

{ "outcome": "answered|voicemail|...", "callResultId": "<id>",
  "meetingBooked": bool, "activityId": "<id>", "summary": "<one sentence>" }
""".strip()

MODEL = os.environ.get("VOICE_MODEL", "global.amazon.nova-2-lite-v1:0")

# ICP call result schema — defines what CALL-E should extract
QUALIFICATION_RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "budget":            {"type": "string"},
        "authority":         {"type": "string"},
        "need":              {"type": "string"},
        "timeline":          {"type": "string"},
        "interest_level":    {"type": "string", "enum": ["high", "medium", "low", "none"]},
        "meeting_booked":    {"type": "boolean"},
        "objections":        {"type": "array", "items": {"type": "string"}},
        "next_step":         {"type": "string"},
    },
    "required": ["interest_level", "meeting_booked"],
}


def run(event: dict) -> dict:
    """
    Entry point invoked by Step Functions (PlaceVoiceCall state).

    Event shape (call initiation):
      { tenantId, contactId, campaignId, agentRunId,
        toPhone, callGoal, taskToken, idempotencyKey,
        contactTimezone?, contactCountry? }

    Event shape (call result processing — ProcessCallResult state):
      { tenantId, contactId, agentRunId, callResult: { ... } }
    """
    agent = Agent(
        model=build_model(MODEL),
        system_prompt=SYSTEM_PROMPT,
        tools=[
            get_contact_context,
            validate_calling_window,
            check_dnc_registry,
            place_call_via_calle,
            write_call_result,
            write_activity,
        ],
    )

    tenant_id    = event.get("tenantId", "")
    contact_id   = event.get("contactId", "")
    agent_run_id = event.get("agentRunId", "")
    call_result  = event.get("callResult")

    if call_result:
        # ProcessCallResult mode — summarise and write the call result
        prompt = (
            f"Process this completed call result.\n"
            f"Tenant ID:    {tenant_id}\n"
            f"Contact ID:   {contact_id}\n"
            f"Agent Run ID: {agent_run_id}\n"
            f"Call result:  {json.dumps(call_result)}\n\n"
            f"Write the call result to CRM and log a clear activity summary."
        )
    else:
        # PlaceVoiceCall mode — initiate the async call
        to_phone        = event.get("toPhone", "")
        call_goal       = event.get("callGoal", "qualification")
        task_token      = event.get("taskToken", "")
        idempotency_key = event.get("idempotencyKey", f"{contact_id}-{agent_run_id}")
        timezone        = event.get("contactTimezone", "Europe/London")
        country         = event.get("contactCountry", "GB")

        result_schema = QUALIFICATION_RESULT_SCHEMA if call_goal == "qualification" else {}

        prompt = (
            f"Initiate a {call_goal} call.\n"
            f"Tenant ID:        {tenant_id}\n"
            f"Contact ID:       {contact_id}\n"
            f"Agent Run ID:     {agent_run_id}\n"
            f"Phone:            {to_phone}\n"
            f"Timezone:         {timezone}\n"
            f"Country:          {country}\n"
            f"Call goal:        {call_goal}\n"
            f"Result schema:    {json.dumps(result_schema)}\n"
            f"Task token:       {task_token}\n"
            f"Idempotency key:  {idempotency_key}\n\n"
            f"Follow the calling checklist. Pass the task_token exactly as given to place_call_via_calle. "
            f"RETURN IMMEDIATELY after placing the call — do not wait for a result."
        )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "contactId": contact_id}
