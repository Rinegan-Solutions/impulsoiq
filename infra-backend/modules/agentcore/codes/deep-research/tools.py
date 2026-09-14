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

from impulsoiq_secrets import app_secret
from .research_search import licensed_search, search_companies

from decimal import Decimal

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
_dynamo = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _ddb_safe(value):
    """DynamoDB rejects Python float; nested findings always carry confidence."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _ddb_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_ddb_safe(v) for v in value]
    return value


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

    table.put_item(Item=_ddb_safe({
        "pk":        f"{tenant_id}#research#{session_id}",
        "sk":        f"{now}#{strategy}",
        "strategy":  strategy,
        "findings":  findings if isinstance(findings, list) else [],
        "confidence": str(confidence),
        "writtenAt": now,
        "ttl":       ttl,
    }))
    return {"ok": True, "strategy": strategy, "findingsCount": len(findings)}


# ── Data sources for sub-agents ───────────────────────────────────────────────

@tool
def get_closed_won_profiles(tenant_id: str, limit: int = 20) -> dict:
    """
    Read closed-won deals (with account industry/size) plus existing accounts.

    Do NOT use get_pipeline_data for this — that view excludes Closed Won.
    Empty closed-won history is a gap, not a hard stop: still search from the
    research goal and from accounts already in the workspace.
    """
    deals = _read("list_closed_won_deals", {"limit": limit}, tenant_id)
    accounts = _read("list_accounts", {"page": 1, "pageSize": min(limit, 20)}, tenant_id)
    profiles = deals.get("result") if isinstance(deals.get("result"), list) else []
    account_items = (accounts.get("result") or {})
    if isinstance(account_items, dict):
        account_items = account_items.get("items") or []
    if not isinstance(account_items, list):
        account_items = []
    gap = ""
    if deals.get("ok") is False:
        gap = str(deals.get("error") or "closed_won_read_failed")
    elif not profiles:
        gap = "no_closed_won"
    return {
        "profiles": profiles[:limit],
        "accounts": account_items[:limit],
        "gap": gap,
        "message": (
            "No closed-won deals yet. Use the research goal and existing accounts "
            "as the ICP, then search_public_signals — do not return empty findings."
            if gap == "no_closed_won" else ""
        ),
    }


def _stub_allowed() -> bool:
    """
    Fabricated research results are NEVER allowed in production.

    This tool used to return "Company 1 (via firmographic_match)" rows
    unconditionally, and the synthesis step ranked them into a report the
    customer reads — invented companies presented as research. Same rule as the
    voice provider stub: off-prod only, and only when explicitly switched on.
    """
    if os.environ.get("ENV", "dev") == "prod":
        return False
    return os.environ.get("ALLOW_RESEARCH_STUB", "").lower() == "true"


def _search_provider() -> tuple[str, str]:
    url = (os.environ.get("RESEARCH_SEARCH_API_URL", "")
           or os.environ.get("ENRICHMENT_API_URL", "")).rstrip("/")
    key = (os.environ.get("RESEARCH_SEARCH_API_KEY", "")
           or os.environ.get("ENRICHMENT_API_KEY", "")).strip()
    # Only open Secrets Manager when a URL exists and env did not already
    # supply a key. An empty secret (no AWSCURRENT) must not crash the tool.
    if url and not key:
        key = app_secret("enrichment_api_key")
    return url, key


@tool
def search_public_signals(
    query:    str,
    strategy: str,
    limit:    int = 10,
) -> dict:
    """
    Find real companies matching a research query.

    Order: licensed /search endpoint (if configured) → Wikipedia / Wikidata /
    GDELT (public, cited) → Nova web grounding (US) → off-prod stub last.

    strategy: 'firmographic_match' | 'technographic_match' | 'news_signal' | 'lookalike'

    Always write whatever companies come back to session memory. An empty
    closed-won list is not a reason to skip this tool.
    """
    cap = max(1, min(int(limit or 10), 15))
    url, key = _search_provider()
    licensed = licensed_search(url, key, query, strategy, cap) if url and key else []
    public, tried = search_companies(query, strategy, cap)
    results = []
    seen: set[str] = set()
    for row in licensed + public:
        name = (row.get("company") or "").strip().lower()
        if not name or name in seen:
            continue
        seen.add(name)
        results.append(row)
        if len(results) >= cap:
            break

    if results:
        return {
            "results": results,
            "query": query,
            "strategy": strategy,
            "source": ",".join(dict.fromkeys(
                [r.get("source") for r in results if r.get("source")] + tried
            )),
            "count": len(results),
        }

    if _stub_allowed():
        return {
            "results": [
                {"company": f"Company {i+1} (via {strategy})", "company_name": f"Company {i+1} (via {strategy})",
                 "source": "research_stub", "signal": query, "reason": query,
                 "confidence": round(0.9 - i * 0.08, 2)}
                for i in range(min(cap, 5))
            ],
            "query": query,
            "strategy": strategy,
            "isStub": True,
        }

    return {
        "results": [],
        "query": query,
        "strategy": strategy,
        "sourcesTried": tried,
        "gap": "no_research_results",
        "message": (
            "Public search returned no citable companies for this query. "
            "Say so in findings — do not invent names."
        ),
    }


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
    reporting = _dynamo.Table(os.environ.get("REPORTING_TABLE", ""))
    now       = datetime.datetime.utcnow().isoformat() + "Z"
    ttl       = int(datetime.datetime.utcnow().timestamp()) + 30 * 86_400  # 30-day TTL
    companies = ranked_companies if isinstance(ranked_companies, list) else []

    body = _ddb_safe({
        "pk":               f"{tenant_id}#report#deep_research",
        "sk":               now,
        "report_type":      "deep_research",
        "tenant_id":        tenant_id,
        "sessionId":        session_id,
        "goal":             goal,
        "rankedCompanies":  companies,
        "methodology":      methodology,
        "costTokens":       int(cost_tokens or 0),
        "generatedAt":      now,
        "ttl":              ttl,
    })
    reporting.put_item(Item=body)
    latest = dict(body)
    latest["sk"] = "latest"
    reporting.put_item(Item=latest)
    return {"ok": True, "reportWritten": True, "companyCount": len(companies)}
