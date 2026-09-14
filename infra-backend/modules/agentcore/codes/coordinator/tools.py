"""
Coordinator Agent — tool definitions.

Rules enforced here:
- ALL CRM writes go through the CRM Write Service Lambda (never direct DSQL).
- Consent is checked as a hard gate before any outbound action.
- Agent runs are logged via write_crm_record before and after execution.
"""
import json
import os
import uuid
import boto3
from strands import tool

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_sfn    = boto3.client("stepfunctions", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _invoke_crm_write(operation: str, payload: dict, tenant_id: str, actor_type: str = "agent") -> dict:
    """Internal helper — always use write_crm_record tool publicly."""
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_WRITE_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({
            "operation": operation,
            "payload":   payload,
            "tenantId":  tenant_id,
            "actorType": actor_type,
            "actorId":   "coordinator-agent",
        }).encode(),
    )
    result = json.loads(resp["Payload"].read())
    if resp.get("FunctionError"):
        raise RuntimeError(f"CRM write failed: {result}")
    return result


@tool
def check_consent(tenant_id: str, contact_id: str, channel: str) -> dict:
    """
    Hard gate: verify that a ConsentRecord granting permission exists before
    any outbound action (email / SMS / call). Returns {hasConsent: bool, reason?: str}.

    NEVER proceed with outbound actions if hasConsent is False.
    """
    return _invoke_crm_write(
        "check_consent",
        {"contactId": contact_id, "channel": channel},
        tenant_id,
    )


@tool
def write_crm_record(tenant_id: str, operation: str, payload: dict) -> dict:
    """
    Write a record to Aurora DSQL via the CRM Write Service.

    All DSQL writes in the system MUST use this tool. Agents never write to
    DSQL directly. Supported operations:
      upsert_contact, upsert_account, upsert_deal, upsert_activity,
      upsert_agent_run, upsert_campaign, upsert_call_result, upsert_consent_record

    Returns {ok: bool, id: str}. On OCC_CONFLICT, the caller should retry.
    """
    return _invoke_crm_write(operation, payload, tenant_id)


@tool
def start_campaign_execution(
    tenant_id: str,
    campaign_id: str,
    contact_ids: list,
) -> dict:
    """
    Start Step Functions executions for a batch of contacts in a campaign.
    Returns {started: int, executionArns: list[str]}.
    """
    state_machine_arn = os.environ.get("STATE_MACHINE_ARN", "")
    arns = []
    for cid in contact_ids:
        resp = _sfn.start_execution(
            stateMachineArn = state_machine_arn,
            name            = f"{campaign_id}-{cid}-{__import__('time').time_ns()}",
            input           = json.dumps({
                "tenantId":    tenant_id,
                "campaignId":  campaign_id,
                "contactId":   cid,
                "agentRunId":  str(uuid.uuid4()),
            }),
        )
        arns.append(resp["executionArn"])
    return {"started": len(arns), "executionArns": arns}


@tool
def check_metering_quota(tenant_id: str, resource: str, amount: int = 1) -> dict:
    """
    Check whether the tenant has remaining quota for a metered resource.
    Reads the DynamoDB metering table SYNCHRONOUSLY before any metered action
    (per Phase 3C spec: "checked pre-action, not just reported after the fact").

    resource: llm_tokens | call_minutes | enrichment_lookups | email_sends |
              sms_sends | agent_runs

    Returns { allowed: bool, remaining: int, used: int, quota: int, resource: str }.
    If allowed is False, the Coordinator must route to a human escalation path.
    """
    import datetime
    metering_specific = os.environ.get("METERING_TABLE", "") or os.environ.get("DYNAMODB_TABLE", "")
    closed_resources = {"call_minutes", "enrichment_lookups", "email_sends", "sms_sends", "agent_runs", "concurrent_runs"}
    fail_open = os.environ.get("METERING_FAIL_OPEN", "").lower() == "true" and os.environ.get("ENV") != "prod"

    if not metering_specific:
        if fail_open and resource not in closed_resources:
            return {"allowed": True, "remaining": 0, "resource": resource, "failedOpen": True}
        return {
            "allowed": False,
            "remaining": 0,
            "resource": resource,
            "failedClosed": True,
            "reason": "METERING_TABLE is not configured",
        }

    # Per-tier quota limits (Phase 3C defines these)
    TIER_QUOTAS: dict = {
        "free":       {"llm_tokens": 20_000,     "call_minutes": 0,   "enrichment_lookups": 25,    "email_sends": 50,     "sms_sends": 0,      "agent_runs": 20,     "concurrent_runs": 1},
        "starter":    {"llm_tokens": 100_000,    "call_minutes": 10,  "enrichment_lookups": 100,   "email_sends": 1_000,  "sms_sends": 0,      "agent_runs": 100,    "concurrent_runs": 3},
        "growth":     {"llm_tokens": 1_000_000,  "call_minutes": 100, "enrichment_lookups": 1_000, "email_sends": 10_000, "sms_sends": 2_000,  "agent_runs": 1_000,  "concurrent_runs": 10},
        "enterprise": {"llm_tokens": 10_000_000, "call_minutes": 500, "enrichment_lookups": 5_000, "email_sends": 100_000,"sms_sends": 10_000, "agent_runs": 10_000, "concurrent_runs": 50},
    }

    period = datetime.datetime.utcnow().strftime("%Y-%m")

    try:
        ddb   = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
        table = ddb.Table(metering_specific)

        # Read current usage counter
        resp  = table.get_item(Key={
            "pk": f"{tenant_id}#meter#{period}",
            "sk": resource,
        })
        item  = resp.get("Item", {})
        used  = int(item.get("count", 0))
        tier = "free"
        try:
            crm_read = os.environ.get("CRM_READ_SERVICE_ARN", "")
            if crm_read:
                tenant_resp = _lambda.invoke(
                    FunctionName=crm_read,
                    InvocationType="RequestResponse",
                    Payload=json.dumps({
                        "operation": "get_tenant",
                        "payload": {},
                        "tenantId": tenant_id,
                    }).encode(),
                )
                tenant_body = json.loads(tenant_resp["Payload"].read())
                row = tenant_body.get("result") or {}
                if row.get("tier"):
                    tier = str(row["tier"])
        except Exception as te:
            print(f"WARN: tenant tier lookup failed, using free: {te}")
            tier = "free"
        defaults = TIER_QUOTAS.get(tier, TIER_QUOTAS["free"])
        quota = int(item.get("quota", defaults.get(resource, 0)))

        if not item:
            quota = defaults.get(resource, 0)

        remaining = max(0, quota - used)
        allowed   = (used + amount) <= quota

        return {
            "allowed":   allowed,
            "used":      used,
            "quota":     quota,
            "remaining": remaining,
            "resource":  resource,
            "period":    period,
        }
    except Exception as e:
        print(f"ERROR: check_metering_quota failed — failing closed: {e}")
        return {
            "allowed": False,
            "remaining": 0,
            "resource": resource,
            "failedClosed": True,
            "reason": str(e),
        }


@tool
def validate_template_compliance(
    template_key: str,
    action_type: str,
    content: str = "",
    days_overdue: int = 0,
    amount_usd: float = 0.0,
) -> dict:
    """
    Validate an action against the workspace template's compliance rules.

    Must be called BEFORE any send or call action when templateContext is present.

    action_type: 'send_email' | 'send_sms' | 'place_call'
    content:     draft message body (for tone validation in 5B)
    days_overdue, amount_usd: for 5B escalation threshold check

    Returns { allowed: bool, reason?: str, escalateToHuman?: bool }
    """
    try:
        from .templates import get_template, is_escalation_required
        template   = get_template(template_key)
        rules      = template.get("complianceRules", {})
    except (KeyError, ImportError):
        return {"allowed": True, "reason": "template_not_found_fail_open"}

    # 5B escalation check (deterministic ladder — NOT LLM)
    if is_escalation_required(template_key, days_overdue, amount_usd) and action_type == "place_call":
        return {
            "allowed":         False,
            "escalateToHuman": True,
            "reason": (
                f"5B escalation threshold exceeded: "
                f"{days_overdue}d overdue / ${amount_usd:.0f}. "
                f"This call MUST be placed by a human, not the automated agent."
            ),
        }

    # 5B tone validation (content check)
    if rules.get("toneFixed") and content:
        prohibited = rules.get("prohibitedContent", [])
        for forbidden in prohibited:
            term = forbidden.replace("_", " ").lower()
            if term in content.lower():
                return {
                    "allowed": False,
                    "reason":  f"Content violates fixed-tone rule: '{forbidden}' detected. "
                               f"Revise to be polite, non-aggressive, and informational.",
                }

    # Check allowed channels
    allowed_channels = rules.get("channels", ["email", "sms", "call"])
    channel_map = {"send_email": "email", "send_sms": "sms", "place_call": "call"}
    channel = channel_map.get(action_type, "email")
    if channel not in allowed_channels:
        return {
            "allowed": False,
            "reason":  f"Template '{template_key}' does not allow channel '{channel}'. "
                       f"Allowed: {allowed_channels}",
        }

    return {"allowed": True}


@tool
def build_execution_plan(
    tenant_id: str,
    goal: str,
    contact_id: str,
    campaign_id: str,
    available_channels: list,
    template_key: str = "",
) -> dict:
    """
    Build a deterministic Graph execution plan for the given goal and contact.
    Returns a list of steps with agent_type, action, and required_consent_channel.

    The Coordinator uses Graph topology exclusively in Phase 1. Swarm is deferred to Phase 4.
    """
    # Load template-specific overrides if a template is active
    template_ctx: dict = {}
    if template_key:
        try:
            from .templates import get_template
            t = get_template(template_key)
            template_ctx = {
                "brandVoiceProfile": t.get("brandVoiceProfile"),
                "approvalGateMode":  t["approvalGateConfig"].get("mode"),
                "allowedCallTypes":  t.get("callTypes", []),
                "maxTouches":        t.get("maxTouches", 5),
                "complianceJurisdiction": t["complianceRules"].get("jurisdiction"),
            }
        except (KeyError, ImportError):
            pass

    return {
        "tenantId":    tenant_id,
        "contactId":   contact_id,
        "campaignId":  campaign_id,
        "goal":        goal,
        "templateKey": template_key,
        "templateContext": template_ctx,
        "steps": [
            {"order": 1, "agentType": "research_enrichment", "action": "enrich_contact",
             "input": {"contactId": contact_id}, "requiredConsentChannel": None},
            {"order": 2, "agentType": "outreach", "action": "send_email",
             "input": {"contactId": contact_id, "channel": "email"}, "requiredConsentChannel": "email"},
            {"order": 3, "agentType": "voice", "action": "qualification_call",
             "input": {"contactId": contact_id, "callType": "qualification"}, "requiredConsentChannel": "call"},
        ],
        "topology": "graph",
    }


@tool
def check_send_pause(tenant_id: str) -> dict:
    """
    Check whether the tenant's outbound messaging is currently paused due to a
    SES reputation event (high bounce rate or complaint rate).

    This is checked by the Coordinator BEFORE delegating to the Outreach agent
    for any email or SMS send — same mechanism as the consent gate.

    Returns { paused: bool, reason?: str, pausedAt?: str }.
    If paused is True, the Coordinator must NOT delegate to Outreach for any
    send actions. It should log the block as an activity and move to the next
    step or exit the campaign run.

    The pause flag is written by the send-pause-enforcer Lambda (triggered by
    a CloudWatch alarm on SES Reputation.BounceRate > 5% or
    Reputation.ComplaintRate > 0.1%).
    """
    """
    Check whether the tenant's outbound messaging is currently paused due to a
    SES reputation event or an account-wide kill.

    Returns { paused: bool, reason?: str, pausedAt?: str }.
    Fail closed in production if the table cannot be read.
    """
    import boto3
    ddb_table = os.environ.get("DYNAMODB_TABLE", "")
    if not ddb_table:
        if os.environ.get("ENV") == "prod":
            return {"paused": True, "reason": "send_pause_table_unconfigured"}
        return {"paused": False}
    ddb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
    table = ddb.Table(ddb_table)
    for pk in (f"{tenant_id}#send_flags#send_pause", "global#send_flags#send_pause"):
        try:
            response = table.get_item(Key={"pk": pk, "sk": "current"})
        except Exception as exc:
            if os.environ.get("ENV") == "prod":
                return {"paused": True, "reason": f"send_pause_check_failed:{exc}"}
            continue
        item = response.get("Item")
        if not item or not item.get("paused"):
            continue
        reason = item.get("reason", "reputation")
        # account_kill is not a 24h SES alarm; it holds until explicitly cleared.
        if reason != "account_kill":
            paused_at = item.get("pausedAt", "")
            if paused_at:
                try:
                    import datetime
                    paused_dt = datetime.datetime.fromisoformat(paused_at.replace("Z", "+00:00"))
                    if (datetime.datetime.now(datetime.timezone.utc) - paused_dt).total_seconds() > 86400:
                        continue
                except ValueError:
                    pass
        return {
            "paused": True,
            "reason": reason,
            "pausedAt": item.get("pausedAt", ""),
        }
    return {"paused": False}
