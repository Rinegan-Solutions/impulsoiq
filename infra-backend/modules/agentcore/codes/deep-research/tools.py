"""
Deep Research Agent — tool definitions (Phase 4B).

These tools are used by BOTH the Swarm coordinator and the 4 specialist sub-agents.
Each sub-agent uses a subset relevant to its strategy.

COST GOVERNANCE: Every tool that calls an external API is metered. The Coordinator
checks check_metering_quota BEFORE spawning the Swarm. Individual sub-agent tool
calls are tracked by the metering-aggregator.
"""
import json
import os
import datetime
import boto3
from strands import tool

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_dynamo = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _read(op: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_READ_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({"operation": op, "payload": payload, "tenantId": tenant_id}).encode(),
    )
    return json.loads(resp["Payload"].read())


# ── Session memory — shared scratch-space across all sub-agents ───────────────

def _session_table():
    return _dynamo.Table(os.environ.get("DYNAMODB_TABLE", ""))


@tool
def read_session_memory(tenant_id: str, session_id: str) -> dict:
    """
    Read the current session memory for a Swarm research run.
    Used by the synthesis coordinator to aggregate all sub-agent findings.
    """
    table = _session_table()
    resp  = table.query(
        KeyConditionExpression = "pk = :pk",
        ExpressionAttributeValues = {":pk": f"{tenant_id}#research#{session_id}"},
    )
    return {"findings": resp.get("Items", []), "sessionId": session_id}


@tool
def write_to_session_memory(
    tenant_id:   str,
    session_id:  str,
    strategy:    str,
    findings:    list,
    confidence:  float,
) -> dict:
    """
    Write sub-agent findings to the shared session memory.
    All 4 sub-agents write here; the synthesis coordinator reads all of them.

    strategy:   firmographic | technographic | news_signals | lookalike_network
    findings:   list of { company_name, reason, source, confidence }
    confidence: 0.0–1.0 overall confidence for this strategy's findings
    """
    table = _session_table()
    now   = datetime.datetime.utcnow().isoformat() + "Z"
    ttl   = int(datetime.datetime.utcnow().timestamp()) + 86_400  # 24-hour TTL

    table.put_item(Item={
        "pk":        f"{tenant_id}#research#{session_id}",
        "sk":        f"{now}#{strategy}",
        "strategy":  strategy,
        "findings":  findings,
        "confidence": str(confidence),
        "writtenAt": now,
        "ttl":       ttl,
    })
    return {"ok": True, "strategy": strategy, "findingsCount": len(findings)}


# ── Data sources for sub-agents ───────────────────────────────────────────────

@tool
def get_closed_won_profiles(tenant_id: str, limit: int = 20) -> dict:
    """
    Read the profiles of closed-won deals from DSQL.
    Used by all sub-agents as the 'ideal customer' baseline.
    Returns company names, industries, sizes, and deal values.
    """
    deals = _read("get_pipeline_data", {"stage": "Closed Won", "lookbackDays": 365}, tenant_id)
    return {"profiles": (deals.get("result") or [])[:limit]}


@tool
def search_public_signals(
    query:    str,
    strategy: str,
    limit:    int = 10,
) -> dict:
    """
    Search for companies matching a research query using public signals.
    For the hackathon, this is a stub that returns structured placeholder data.
    In production: integrates with Clearbit, Apollo, or a web search tool.

    strategy: describes what signal type to look for
              ('firmographic_match', 'technographic_match', 'news_signal', 'lookalike')
    """
    # Stub — production implementation calls enrichment API or AgentCore Browser tool
    placeholder_results = [
        {"company": f"Company {i+1} (via {strategy})", "source": "enrichment_api_stub",
         "signal": query, "confidence": round(0.9 - i * 0.08, 2)}
        for i in range(min(limit, 5))
    ]
    return {"results": placeholder_results, "query": query, "strategy": strategy, "isStub": True}


@tool
def write_research_report(
    tenant_id:    str,
    session_id:   str,
    goal:         str,
    ranked_companies: list,
    methodology:  str,
    cost_tokens:  int,
) -> dict:
    """
    Write the final synthesised research report to the reporting DynamoDB table.
    Called by the synthesis coordinator after reading all sub-agent session memory.

    ranked_companies: list of { rank, company_name, reasons: list, sources: list, confidence }
    methodology:      plain-text explanation of how results were derived
    """
    import boto3 as _boto3
    reporting = _dynamo.Table(os.environ.get("REPORTING_TABLE", ""))
    now       = datetime.datetime.utcnow().isoformat() + "Z"
    ttl       = int(datetime.datetime.utcnow().timestamp()) + 30 * 86_400  # 30-day TTL

    reporting.put_item(Item={
        "pk":               f"{tenant_id}#report#deep_research",
        "sk":               now,
        "report_type":      "deep_research",
        "tenant_id":        tenant_id,
        "sessionId":        session_id,
        "goal":             goal,
        "rankedCompanies":  ranked_companies,
        "methodology":      methodology,
        "costTokens":       cost_tokens,
        "generatedAt":      now,
        "ttl":              ttl,
    })
    # Latest pointer
    reporting.put_item(Item={
        "pk":              f"{tenant_id}#report#deep_research",
        "sk":              "latest",
        "report_type":     "deep_research",
        "tenant_id":       tenant_id,
        "sessionId":       session_id,
        "goal":            goal,
        "rankedCompanies": ranked_companies,
        "generatedAt":     now,
        "ttl":             ttl,
    })
    return {"ok": True, "reportWritten": True, "companyCount": len(ranked_companies)}
