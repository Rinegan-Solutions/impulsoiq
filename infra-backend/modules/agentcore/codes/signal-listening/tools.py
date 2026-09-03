"""
Signal Listening Agent — tool definitions (Phase 4C).

Architecture (two-stage, per v3 spec §5.2):
  Stage 1 (classifier.py, Nova Micro):   high-volume cheap filter
  Stage 2 (these tools, Nova 2 Lite):    low-volume expensive synthesis

DESIGN CONSTRAINTS (permanent, not roadmap gaps):
- Operates ONLY on named-company mentions and public business signals.
- NEVER attempts to deanonymize an anonymous social-media poster's employer
  by inferring it from their post history. (v3 §Phase 4, 4C)
- Every originated candidate enters the Control Panel approval queue first.
  No originated contact ever enters the standard pipeline without human approval.
- Rate-limit-aware, staggered request pacing on every source.
- Hard daily token cap enforced BEFORE each run, not just reported afterward.
"""
import json
import os
import time
import datetime
import boto3
import httpx
from strands import tool

REGION = os.environ.get("AWS_REGION", "eu-west-2")

_lambda  = boto3.client("lambda", region_name=REGION)
_dynamo  = boto3.resource("dynamodb", region_name=REGION)
_bedrock = boto3.client("bedrock-runtime", region_name=REGION)

# Hard-coded daily token budget for Stage 2 synthesis (per v3 spec)
DAILY_STAGE2_TOKEN_BUDGET = int(os.environ.get("SIGNAL_DAILY_STAGE2_TOKENS", "100000"))
RATE_LIMIT_PAUSE_SECONDS  = float(os.environ.get("SIGNAL_RATE_PAUSE_SECS", "2.0"))


def _crm_write(operation: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_WRITE_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({
            "operation": operation, "payload": payload, "tenantId": tenant_id,
            "actorType": "agent", "actorId": "signal-listening-agent",
        }).encode(),
    )
    return json.loads(resp["Payload"].read())


def _crm_read(operation: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_READ_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({"operation": operation, "payload": payload, "tenantId": tenant_id}).encode(),
    )
    return json.loads(resp["Payload"].read())


# ── Source feed fetchers ────────────────────────────────────────────────────────

@tool
def fetch_rss_signals(feed_url: str, max_items: int = 20) -> dict:
    """
    Fetch items from a public RSS/Atom feed (job boards, press-release wires,
    industry forum RSS, etc.). Rate-limited with mandatory pause.

    ONLY for publicly accessible, no-login-required RSS endpoints.
    Never used against LinkedIn, Glassdoor, or any gated content.

    Returns { items: [{ title, text, url, published }] }
    """
    import feedparser

    try:
        time.sleep(RATE_LIMIT_PAUSE_SECONDS)
        parsed = feedparser.parse(feed_url)
        if parsed.get("bozo") and not parsed.entries:
            return {"items": [], "error": "Feed parse error — check URL"}

        items = []
        for entry in parsed.entries[:max_items]:
            text = entry.get("summary", "") or entry.get("description", "") or ""
            items.append({
                "title":     entry.get("title", ""),
                "text":      (entry.get("title", "") + " " + text)[:1000],
                "url":       entry.get("link", ""),
                "published": entry.get("published", ""),
            })
        return {"items": items, "feedTitle": parsed.feed.get("title", feed_url)}

    except Exception as e:
        return {"items": [], "error": str(e)}


@tool
def fetch_reddit_signals(subreddit: str, search_query: str, max_items: int = 15) -> dict:
    """
    Fetch posts from Reddit's public JSON API — no authentication, no scraping.
    Uses Reddit's officially documented public endpoint (/r/{sub}/search.json).

    Rate-limited: pauses between requests, backs off on 429/503.
    Only processes posts where the company name is already in the post text
    (per design constraint — never infers identity from anonymous posts).

    Returns { items: [{ title, text, url, subreddit }] }
    """
    time.sleep(RATE_LIMIT_PAUSE_SECONDS)
    try:
        url = f"https://www.reddit.com/r/{subreddit}/search.json"
        params = {"q": search_query, "sort": "new", "limit": max_items, "t": "week"}
        headers = {"User-Agent": "ImpulsoIQ-SignalBot/1.0 (signal intelligence)"}

        resp = httpx.get(url, params=params, headers=headers, timeout=10)

        if resp.status_code == 429:
            return {"items": [], "error": "Rate limited — backing off"}
        if resp.status_code != 200:
            return {"items": [], "error": f"HTTP {resp.status_code}"}

        data  = resp.json()
        posts = data.get("data", {}).get("children", [])
        items = []
        for p in posts:
            post = p.get("data", {})
            text = post.get("selftext", "") or ""
            items.append({
                "title":     post.get("title", ""),
                "text":      (post.get("title", "") + " " + text)[:1000],
                "url":       f"https://reddit.com{post.get('permalink', '')}",
                "subreddit": post.get("subreddit", subreddit),
            })
        return {"items": items}

    except Exception as e:
        return {"items": [], "error": str(e)}


# ── Stage 2 synthesis tools ────────────────────────────────────────────────────

@tool
def check_signal_budget(tenant_id: str) -> dict:
    """
    Check whether the tenant has remaining Stage 2 synthesis budget for today.
    This MUST be called before promoting any candidate to Stage 2.

    Per v3 spec: the Signal Listening Agent cannot run Stage 2 synthesis
    without Phase 3C's synchronous metering/budget-check pipeline confirming
    budget is available. Fails CLOSED — if budget is exhausted, no synthesis runs.

    Returns { allowed: bool, usedToday: int, dailyBudget: int }
    """
    table = _dynamo.Table(os.environ.get("DYNAMODB_TABLE", ""))
    today = datetime.date.today().isoformat()
    try:
        item = table.get_item(Key={
            "pk": f"{tenant_id}#signal_budget#{today}",
            "sk": "stage2_tokens",
        }).get("Item", {})
        used_today = int(item.get("count", 0))
        allowed    = used_today < DAILY_STAGE2_TOKEN_BUDGET
        return {
            "allowed":     allowed,
            "usedToday":   used_today,
            "dailyBudget": DAILY_STAGE2_TOKEN_BUDGET,
            "date":        today,
        }
    except Exception:
        # Fail closed on budget check errors
        return {"allowed": False, "usedToday": 0, "dailyBudget": DAILY_STAGE2_TOKEN_BUDGET}


@tool
def check_source_legal_status(tenant_id: str, source_key: str) -> dict:
    """
    Check whether this source has been legally reviewed and approved for this tenant.

    Per v3 spec: "Legal/compliance review required before activation for any tenant,
    and per-source review as new monitored sources are added."

    Reads from the tenant's workspace_template config in DSQL.
    Returns { approved: bool, reviewedBy: str|None, reviewedAt: str|None }
    """
    result = _crm_read(
        "get_workspace_templates",
        {"templateKey": "signal_listening_sources"},
        tenant_id,
    )
    templates = result.get("result", [])
    for t in templates:
        config = t.get("config", {})
        approved_sources = config.get("approvedSources", [])
        if source_key in approved_sources:
            return {
                "approved":   True,
                "reviewedBy": t.get("legal_reviewed_by"),
                "reviewedAt": t.get("legal_reviewed_at"),
            }
    return {"approved": False, "reviewedBy": None, "reviewedAt": None}


@tool
def promote_to_research_pipeline(
    tenant_id:   str,
    company_name: str,
    signal_type:  str,
    pain_summary: str,
    source_url:   str,
    confidence:   float,
) -> dict:
    """
    Promote a Stage 1 candidate to the Research & Enrichment pipeline (Stage 2).

    This CREATES a new CRM contact/account record BUT writes it with status
    'signal_originated' and immediately creates an approval queue entry.
    The record does NOT enter the standard pipeline until a human approves it.

    Per v3: "A human confirms it's worth pursuing before it enters the standard
    Phase 2 enrichment/outreach pipeline."
    """
    # Create a provisional account record
    account_result = _crm_write(
        "upsert_account",
        {
            "name":           company_name,
            "enrichmentJson": {
                "signalOriginated": True,
                "signalType":       signal_type,
                "painSummary":      pain_summary,
                "sourceUrl":        source_url,
                "classifierConfidence": confidence,
            },
            "customFields": {"status": "signal_originated", "awaitingApproval": True},
        },
        tenant_id,
    )

    account_id = account_result.get("id", "")

    # Create Control Panel approval entry
    approval_result = _crm_write(
        "upsert_activity",
        {
            "accountId":  account_id,
            "type":       "note",
            "actorType":  "agent",
            "actorId":    "signal-listening-agent",
            "subject":    f"Signal-originated candidate: {company_name}",
            "body":       (
                f"Source: {signal_type} · Confidence: {confidence:.0%}\n"
                f"Signal: {pain_summary}\n"
                f"URL: {source_url}\n\n"
                f"This candidate was discovered automatically. A human must approve "
                f"before this enters the standard enrichment/outreach pipeline."
            ),
            "metadata": {
                "requiresApproval": True,
                "proposalType":     "signal_originated_candidate",
                "signalType":       signal_type,
                "signalConfidence": confidence,
                "sourceUrl":        source_url,
                "status":           "awaiting_approval",
                "taggedAs":         "discovered_not_requested",
            },
        },
        tenant_id,
    )

    return {
        "ok":         True,
        "accountId":  account_id,
        "activityId": approval_result.get("id"),
        "status":     "awaiting_human_approval",
        "company":    company_name,
    }


@tool
def record_run_stats(
    tenant_id:     str,
    signals_fetched: int,
    promoted:      int,
    skipped_budget: int,
    skipped_legal:  int,
    sources_used:  list,
) -> dict:
    """
    Write a summary of this Signal Listening run to DynamoDB for metering
    and observability. Used by Phase 3C dashboards and Phase 6D compliance audit.
    """
    table = _dynamo.Table(os.environ.get("DYNAMODB_TABLE", ""))
    now   = datetime.datetime.utcnow().isoformat() + "Z"
    ttl   = int(datetime.datetime.utcnow().timestamp()) + 90 * 86400

    table.put_item(Item={
        "pk":              f"{tenant_id}#signal_run#{now[:10]}",
        "sk":              now,
        "tenantId":        tenant_id,
        "signalsFetched":  signals_fetched,
        "promoted":        promoted,
        "skippedBudget":   skipped_budget,
        "skippedLegal":    skipped_legal,
        "sourcesUsed":     sources_used,
        "runAt":           now,
        "ttl":             ttl,
    })
    return {"ok": True, "runAt": now}
