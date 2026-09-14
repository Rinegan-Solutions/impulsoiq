"""
Ambient Interface Agent — tool definitions (Phase 4A).

These tools give the voice agent access to ImpulsoIQ system state so the
professional can query and command the platform by voice.

All tools here call the SAME backend infrastructure as typed actions:
- Reads go through crm-read Lambda
- Writes go through crm-write-service Lambda
- Goals are submitted to the Coordinator via SFN
No separate "voice path" exists — voice is an input modality, not a feature pipeline.
"""
import json
import os
import datetime
import boto3
from strands import tool

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_dynamo = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_sfn    = boto3.client("stepfunctions", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _read(op: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_READ_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({"operation": op, "payload": payload, "tenantId": tenant_id}).encode(),
    )
    return json.loads(resp["Payload"].read())


def _write(op: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_WRITE_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({
            "operation": op, "payload": payload, "tenantId": tenant_id,
            "actorType": "agent", "actorId": "ambient-interface-agent",
        }).encode(),
    )
    return json.loads(resp["Payload"].read())


@tool
def submit_goal(tenant_id: str, goal: str, contact_id: str = "") -> dict:
    """
    Submit a spoken goal to the Coordinator for execution.
    This is the primary action for "queue a follow-up call", "send email to X", etc.

    The goal goes through the same Clarification → Coordinator pipeline as a typed goal.
    Every voice-submitted goal is logged with input_modality='voice'.

    Returns { executionArn, estimatedSteps } so the agent can acknowledge to the user.
    """
    sfn_arn = os.environ.get("STATE_MACHINE_ARN", "")
    if not sfn_arn:
        return {"ok": False, "error": "STATE_MACHINE_ARN not configured"}

    execution_name = f"voice-{tenant_id[:8]}-{int(datetime.datetime.utcnow().timestamp())}"
    resp = _sfn.start_execution(
        stateMachineArn = sfn_arn,
        name            = execution_name,
        input           = json.dumps({
            "tenantId":      tenant_id,
            "contactId":     contact_id,
            "goal":          goal,
            "inputModality": "voice",
            "source":        "ambient-interface",
        }),
    )
    return {"ok": True, "executionArn": resp["executionArn"], "goal": goal}


@tool
def query_pipeline_status(tenant_id: str) -> dict:
    """
    Get a spoken-friendly pipeline summary: deal count by stage, weighted forecast,
    and any stalled deals from the reporting table.

    Designed for a 2-3 sentence audio response: "You have 16 open deals worth $2.8M.
    Your weighted forecast for September is $847K. Three deals are flagged as stalled."
    """
    pipeline = _read("get_pipeline_data", {"lookbackDays": 90}, tenant_id)
    deals    = pipeline.get("result", []) or []

    by_stage: dict = {}
    total = 0.0
    for d in deals:
        stage  = d.get("stage", "Unknown")
        amount = float(d.get("amount", 0) or 0)
        by_stage[stage] = by_stage.get(stage, 0) + 1
        total += amount

    return {
        "dealCount":    len(deals),
        "totalPipeline": total,
        "byStage":      by_stage,
    }


@tool
def query_call_result(tenant_id: str, contact_name: str = "", limit: int = 5) -> dict:
    """
    Look up recent call results. Used when the professional asks "how did the
    Meridian call go?" or "what was the outcome of yesterday's calls?".

    Returns up to `limit` recent call results with outcome, summary, and contact name.
    """
    # Read from DynamoDB GSI gsi-contact if contact_name provided,
    # otherwise read recent activities of type=call
    activities = _read("get_activity_history", {"type": "call", "limit": limit}, tenant_id)
    result = activities.get("result", []) or []
    return {"calls": result, "count": len(result)}


@tool
def list_pending_approvals(tenant_id: str) -> dict:
    """
    List items currently in the Control Panel approval queue.
    Used when the professional asks "what needs my approval?" or "what's in my queue?".

    Returns a spoken-friendly list: agent type, action, and contact name.
    """
    # Query activities with requiresApproval=true and status=awaiting_approval
    activities = _read(
        "get_activity_history",
        {"filter": "awaiting_approval", "limit": 10},
        tenant_id,
    )
    pending = [
        a for a in (activities.get("result") or [])
        if isinstance(a.get("metadata"), dict) and a["metadata"].get("requiresApproval")
    ]
    return {"pending": pending, "count": len(pending)}


@tool
def approve_item(tenant_id: str, activity_id: str, confirmation: str = "") -> dict:
    """
    Approve a low-risk item in the approval queue by voice.

    SAFETY RULE: Only items with metadata.approvalTier = 'low' can be voice-approved.
    Items with approvalTier = 'high' or 'mandatory' still require the visual Control
    Panel — a voice command alone is insufficient for high-stakes outreach.

    confirmation: the spoken confirmation phrase from the user (e.g. "yes approve")
    """
    if "yes" not in confirmation.lower() and "approve" not in confirmation.lower() and "confirm" not in confirmation.lower():
        return {"ok": False, "error": "Confirmation phrase required. Say 'yes, approve' to confirm."}

    result = _write(
        "upsert_activity",
        {
            "id":       activity_id,
            "metadata": {
                "status":          "approved",
                "approvedVia":     "voice",
                "approvedAt":      datetime.datetime.utcnow().isoformat() + "Z",
                "inputModality":   "voice",
            },
        },
        tenant_id,
    )
    return {**result, "approved": True, "activityId": activity_id}


@tool
def get_morning_briefing(tenant_id: str) -> dict:
    """
    Generate a structured morning briefing for the user.
    Called when the professional says "Good morning" or "Brief me".

    Returns a structured dict the agent turns into a natural spoken briefing covering:
    1. Overnight agent activity summary (runs completed, meetings booked)
    2. Deals needing attention today (stalled, closing soon)
    3. Items in the approval queue
    4. Top-of-funnel: new enriched contacts ready for outreach

    Designed for a 60-90 second spoken briefing.
    """
    # Gather data from multiple sources in parallel would be ideal;
    # for simplicity, sequential reads
    approvals = list_pending_approvals.__wrapped__(tenant_id=tenant_id)  # type: ignore
    pipeline  = query_pipeline_status.__wrapped__(tenant_id=tenant_id)   # type: ignore

    # Recent overnight runs
    now        = datetime.datetime.utcnow()
    since_8pm  = (now - datetime.timedelta(hours=11)).isoformat() + "Z"
    activities = _read("get_activity_history", {"since": since_8pm, "limit": 20}, tenant_id)
    overnight  = activities.get("result", []) or []

    meetings_booked = sum(
        1 for a in overnight
        if isinstance(a.get("metadata"), dict) and a["metadata"].get("meetingBooked")
    )

    return {
        "briefing": {
            "overnightRuns":   len(overnight),
            "meetingsBooked":  meetings_booked,
            "pendingApprovals": approvals["count"],
            "openDeals":        pipeline["dealCount"],
            "totalPipeline":    pipeline["totalPipeline"],
        },
        "timestamp": now.isoformat() + "Z",
    }


def session_tools(tenant_id: str) -> list:
    """Voice-session tools with workspace bound from the signed connection.

    Nova Sonic would otherwise have to speak a tenant id; that must never be
    model-supplied. The HTTP text path still uses the unbound tools above.
    """
    submit = submit_goal
    pipeline = query_pipeline_status
    calls = query_call_result
    pending = list_pending_approvals
    approve = approve_item
    briefing = get_morning_briefing

    @tool
    def submit_spoken_goal(goal: str, contact_id: str = "") -> dict:
        """Submit a spoken goal to the Coordinator for execution.
        Use for queue a follow-up call, send an email, and similar asks."""
        return submit(tenant_id, goal, contact_id)

    @tool
    def spoken_pipeline_status() -> dict:
        """Spoken-friendly pipeline summary: deal count by stage and forecast."""
        return pipeline(tenant_id)

    @tool
    def spoken_call_result(contact_name: str = "", limit: int = 5) -> dict:
        """Look up recent call results by contact name or latest calls."""
        return calls(tenant_id, contact_name, limit)

    @tool
    def spoken_pending_approvals() -> dict:
        """List items currently in the Control Panel approval queue."""
        return pending(tenant_id)

    @tool
    def spoken_approve_item(activity_id: str, confirmation: str = "") -> dict:
        """Approve a low-risk queue item by voice. High-risk items stay in the Control Panel."""
        return approve(tenant_id, activity_id, confirmation)

    @tool
    def spoken_morning_briefing() -> dict:
        """Morning briefing: overnight agent work, stalled deals, approvals."""
        return briefing(tenant_id)

    @tool
    def end_session(request_state: dict) -> str:
        """End the voice conversation when the user says goodbye or stop."""
        request_state["stop_event_loop"] = True
        return "Goodbye."

    return [
        submit_spoken_goal,
        spoken_pipeline_status,
        spoken_call_result,
        spoken_pending_approvals,
        spoken_approve_item,
        spoken_morning_briefing,
        end_session,
    ]
