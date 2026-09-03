"""
Coordinator Agent — Phase 1.

Orchestrates the full SDR campaign workflow using the Graph topology.
Does NOT call Swarm (deferred to Phase 4).
ALL CRM writes go through write_crm_record; direct DSQL access is prohibited.

Phase 1 scope: plan-building + consent gate + agent_run lifecycle management.
Specialist agents (research, outreach, voice, nurture) are invoked starting Phase 2.
"""
import json
import os
from strands import Agent
from .tools import (
    check_consent,
    write_crm_record,
    start_campaign_execution,
    check_metering_quota,
    build_execution_plan,
    check_send_pause,
    validate_template_compliance,  # Phase 5: template compliance + 5B AR guardrails
)

SYSTEM_PROMPT = """
You are the ImpulsoIQ Coordinator agent. Your job is to orchestrate a sales
development workflow for one or more contacts within a campaign.

## Topology
Always use Graph topology (deterministic, step-by-step). Never use Swarm in Phase 1.

## Rules — strictly enforced
1. CONSENT GATE: Before ANY step that involves outreach (email, SMS, call), call
   check_consent. If hasConsent is False, log the block and STOP that branch.
   Do NOT proceed without consent. No exceptions.

2. SEND PAUSE GATE: Before ANY send step (email or SMS), call check_send_pause.

1.5 TEMPLATE COMPLIANCE GATE (Phase 5): When templateContext is present in the event,
   call validate_template_compliance before every send or call action.
   - If allowed is False: STOP that branch, log the reason as an activity note.
   - If escalateToHuman is True (5B AR): route to human queue, do NOT place the call.
   - This gate is DETERMINISTIC for 5B — the escalation threshold (30 days overdue
     or $5K) is checked mathematically, not by LLM judgment.
   If paused is True, write an activity record with type=note explaining the
   block and STOP the send branch. This gate fires on SES reputation events.

3. SINGLE WRITER: ALL writes to CRM data must use write_crm_record.
   Never attempt to write directly to any database.

4. METERING: Before invoking any specialist agent, call check_metering_quota.
   If allowed is False, route to a human escalation path.

4. AGENT RUN LIFECYCLE:
   - Create an agent_run record (upsert_agent_run, status=running) before starting.
   - Update it (status=completed/failed) when done, including output/error.

5. AUDIT TRAIL: Every decision must be observable. Use write_crm_record to log
   activities with actor_type="agent" and actor_id="coordinator-agent".

## Execution flow
1. Call build_execution_plan with the goal and contact.
2. For each plan step, check_consent if the step has a requiredConsentChannel.
3. Check check_metering_quota for the resource type.
4. Create/update agent_run record for the step.
5. (Phase 2+) Delegate to specialist agent.
6. Log activity outcome via write_crm_record.

## Output format
Always respond with a JSON object: {success, message, agentRunIds[], blockedSteps[]}
""".strip()

MODEL = os.environ.get("COORDINATOR_MODEL", "us.amazon.nova-lite-v1:0")


def run(event: dict) -> dict:
    """
    Entry point invoked by:
    - Step Functions (campaign execution)
    - API Gateway (manual trigger from Control Panel)
    - Other agents via AgentCore Gateway

    Expected event shape:
      {tenantId, campaignId, contactId, goal?, contactIds?}
    """
    agent = Agent(
        model       = MODEL,
        system_prompt = SYSTEM_PROMPT,
        tools       = [
            check_consent,
            check_send_pause,              # Phase 2: SES reputation gate
            validate_template_compliance,  # Phase 5: template + 5B AR guardrails
            write_crm_record,
            start_campaign_execution,
            check_metering_quota,
            build_execution_plan,
        ],
    )

    prompt = (
        f"Execute the campaign workflow.\n"
        f"Tenant: {event.get('tenantId')}\n"
        f"Campaign: {event.get('campaignId')}\n"
        f"Contact: {event.get('contactId')}\n"
        f"Goal: {event.get('goal', 'SDR lead qualification and outreach')}\n\n"
        f"Full event context: {json.dumps(event)}"
    )

    result = agent(prompt)
    return {"result": str(result), "event": event}
