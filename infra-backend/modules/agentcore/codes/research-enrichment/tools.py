"""
Research & Enrichment Agent — tool definitions.

Waterfall enrichment order (enforced by system prompt):
  1. get_internal_history  — check what we already know
  2. enrich_from_api       — call external enrichment API (stub for hackathon)
  3. compute_fit_score     — deterministic scoring (NOT LLM-generated)
  4. write_enrichment_result — persist via CRM Write Service

Rules enforced here:
- Scoring uses compute_fit_score (deterministic calculation, not LLM guess).
- All writes go through write_enrichment_result (CRM Write Service).
- No direct DSQL access.
"""
import json
import os
import httpx
import boto3
from strands import tool

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _invoke_lambda(function_arn: str, payload: dict) -> dict:
    """Low-level Lambda invocation helper."""
    resp = _lambda.invoke(
        FunctionName=function_arn,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode(),
    )
    result = json.loads(resp["Payload"].read())
    if resp.get("FunctionError"):
        raise RuntimeError(f"Lambda invocation failed: {result}")
    return result


@tool
def get_internal_history(tenant_id: str, contact_id: str) -> dict:
    """
    Read the contact's existing data, enrichment history, and activity timeline
    from the CRM via the CRM Read Lambda.

    Call this FIRST in the enrichment waterfall — it may provide sufficient
    context without needing an external API call.

    Returns { contact, activities, enrichment_json } or { result: null } if new.
    """
    crm_read_arn = os.environ["CRM_READ_SERVICE_ARN"]
    contact = _invoke_lambda(crm_read_arn, {
        "operation": "get_contact",
        "payload":   {"id": contact_id},
        "tenantId":  tenant_id,
    })
    activities = _invoke_lambda(crm_read_arn, {
        "operation": "get_activity_history",
        "payload":   {"contactId": contact_id, "limit": 10},
        "tenantId":  tenant_id,
    })
    return {
        "contact":    contact.get("result"),
        "activities": activities.get("result", []),
    }


@tool
def get_brand_voice_profile(tenant_id: str) -> dict:
    """
    Fetch the tenant's brand voice profile — tone, persona, messaging pillars —
    from the CRM Read Lambda.

    Use this to calibrate enrichment context before drafting any personalisation
    notes that the Outreach agent will consume.

    Returns the brand_voice_profile JSON object, or null if not configured.
    """
    crm_read_arn = os.environ["CRM_READ_SERVICE_ARN"]
    result = _invoke_lambda(crm_read_arn, {
        "operation": "get_brand_voice_profile",
        "payload":   {},
        "tenantId":  tenant_id,
    })
    return result.get("result") or {}


@tool
def enrich_from_api(contact_email: str, contact_domain: str) -> dict:
    """
    Call the external contact enrichment API to fetch firmographic and
    technographic data for the contact's company.

    Stub for hackathon MVP — logs the call and returns a placeholder response.
    Phase 3: integrate with Apollo.io / Clearbit / PDL.

    Returns { company_name, industry, employee_count, tech_stack[], revenue_band,
              linkedin_url, seniority, job_function } or {} on failure.
    """
    enrichment_api_url = os.environ.get("ENRICHMENT_API_URL", "")
    enrichment_api_key = os.environ.get("ENRICHMENT_API_KEY", "")

    if not enrichment_api_url or not enrichment_api_key:
        # Stub for hackathon
        return {
            "company_name":    contact_domain.split(".")[0].title(),
            "industry":        "Technology",
            "employee_count":  50,
            "revenue_band":    "1M-10M",
            "tech_stack":      ["Salesforce", "HubSpot"],
            "seniority":       "Manager",
            "job_function":    "Sales",
            "source":          "stub",
        }

    try:
        resp = httpx.post(
            enrichment_api_url,
            headers={"Authorization": f"Bearer {enrichment_api_key}", "Content-Type": "application/json"},
            json={"email": contact_email, "domain": contact_domain},
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        # Non-fatal — enrichment failure should not block the campaign
        return {"error": str(exc), "source": "api_failed"}


@tool
def compute_fit_score(contact_data: dict, icp_criteria: dict) -> dict:
    """
    Compute an Ideal Customer Profile (ICP) fit score deterministically.

    THIS MUST USE THIS TOOL — do NOT generate a score by reasoning or guessing.
    The score is a deterministic calculation, not an LLM estimate.

    Scoring rubric (total 100 points):
      - Industry match:        25 pts if contact industry in icp_criteria.industries
      - Employee count range:  20 pts if within icp_criteria.employee_range
      - Seniority:             20 pts if title seniority matches icp_criteria.seniorities
      - Technology overlap:    20 pts per matching technology (max 20)
      - Revenue band:          15 pts if within icp_criteria.revenue_bands

    Returns { score: int (0-100), breakdown: {}, verdict: 'high'|'medium'|'low' }
    """
    score = 0
    breakdown: dict[str, int] = {}

    # Industry match
    contact_industry = (contact_data.get("industry") or "").lower()
    icp_industries   = [i.lower() for i in (icp_criteria.get("industries") or [])]
    if icp_industries and contact_industry in icp_industries:
        score += 25
        breakdown["industry_match"] = 25
    else:
        breakdown["industry_match"] = 0

    # Employee count
    emp_count = contact_data.get("employee_count") or 0
    emp_range = icp_criteria.get("employee_range") or {}
    emp_min   = emp_range.get("min", 0)
    emp_max   = emp_range.get("max", 999_999)
    if emp_min <= emp_count <= emp_max:
        score += 20
        breakdown["employee_count"] = 20
    else:
        breakdown["employee_count"] = 0

    # Seniority
    contact_seniority = (contact_data.get("seniority") or "").lower()
    icp_seniorities   = [s.lower() for s in (icp_criteria.get("seniorities") or [])]
    if icp_seniorities and contact_seniority in icp_seniorities:
        score += 20
        breakdown["seniority"] = 20
    else:
        breakdown["seniority"] = 0

    # Technology overlap
    contact_tech = set(t.lower() for t in (contact_data.get("tech_stack") or []))
    icp_tech     = set(t.lower() for t in (icp_criteria.get("technologies") or []))
    overlap      = contact_tech & icp_tech
    tech_score   = min(20, len(overlap) * 10)
    score += tech_score
    breakdown["technology_overlap"] = tech_score

    # Revenue band
    contact_revenue = (contact_data.get("revenue_band") or "").lower()
    icp_revenues    = [r.lower() for r in (icp_criteria.get("revenue_bands") or [])]
    if icp_revenues and contact_revenue in icp_revenues:
        score += 15
        breakdown["revenue_band"] = 15
    else:
        breakdown["revenue_band"] = 0

    verdict = "high" if score >= 70 else "medium" if score >= 40 else "low"
    return {"score": score, "breakdown": breakdown, "verdict": verdict}


@tool
def write_enrichment_result(
    tenant_id:       str,
    contact_id:      str,
    enrichment_data: dict,
    score:           int,
) -> dict:
    """
    Persist the enrichment result back to the contact record via the CRM Write Service.

    ALL CRM writes MUST use this tool — never call DSQL directly.

    Merges enrichment_data into the contact's enrichment_json field and updates
    the contact's score. Returns { ok: bool, id: str }.
    """
    crm_write_arn = os.environ["CRM_WRITE_SERVICE_ARN"]
    result = _invoke_lambda(crm_write_arn, {
        "operation": "upsert_contact",
        "payload": {
            "id":             contact_id,
            "enrichmentJson": enrichment_data,
            "score":          score,
        },
        "tenantId":  tenant_id,
        "actorType": "agent",
        "actorId":   "research-enrichment-agent",
    })
    return result


@tool
def write_to_memory(
    tenant_id:   str,
    contact_id:  str,
    memory_type: str,
    content:     str,
) -> dict:
    """
    Embed and store a summary in AgentCore Memory long-term store.

    This implements Phase 2A's "embed-on-write pipeline" — every enrichment
    result is stored as a semantic memory so future agents can recall context
    about this contact without re-fetching from external APIs.

    memory_type: 'enrichment_summary' | 'intent_signals' | 'contact_brief'

    The actual embedding is handled by AgentCore Memory; we just write
    structured text. The memory_key uniquely identifies this record so
    future writes with the same key update rather than duplicate.
    """
    import datetime
    # Store as a DynamoDB record so the memory pipeline picks it up.
    # AgentCore Memory's embed-on-write consumer reads from DynamoDB Streams.
    dynamodb_table = os.environ.get("DYNAMODB_TABLE", "")
    import boto3
    ddb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
    table = ddb.Table(dynamodb_table)
    now = datetime.datetime.utcnow().isoformat() + "Z"
    table.put_item(Item={
        "pk":          f"{tenant_id}#memory#{contact_id}",
        "sk":          f"{now}#{memory_type}",
        "tenantId":    tenant_id,
        "contactId":   contact_id,
        "entityType":  "memory",
        "entityId":    contact_id,
        "eventType":   "created",
        "actorType":   "agent",
        "actorId":     "research-enrichment-agent",
        "memoryType":  memory_type,
        "content":     content,
        "data":        {"memory_type": memory_type, "content": content},
        "occurredAt":  now,
    })
    return {"ok": True, "memoryType": memory_type, "contactId": contact_id}


# ── Phase 2A v3: Executive mapping & contact verification (step 4) ──────────────


@tool
def map_executives(company_name: str, company_domain: str, target_titles: list, tenant_id: str) -> dict:
    """
    Resolve named decision-makers at target titles for a given company.

    SOURCE RULE (v3 §Phase 2, 2A): Executive names and titles MUST come from
    the licensed enrichment provider already used in step 2, or a dedicated
    org-chart data provider. The Browser tool is NEVER directed at LinkedIn
    profiles or search — LinkedIn's ToS prohibits automated access regardless
    of data being "public", and enforcement is active. If the licensed provider
    returns no name at the needed title, the result is "no_verified_contact"
    — the agent does NOT fall back to scraping.

    Returns { executives: [{ name, title, emailPattern, source }] }
    """
    # For the hackathon: calls the same enrichment API stub used in enrich_from_api
    # Production: dedicated org-chart provider endpoint
    enrichment_api_url = os.environ.get("ENRICHMENT_API_URL", "")
    if not enrichment_api_url:
        return {"executives": [], "source": "enrichment_api_not_configured"}

    try:
        resp = httpx.post(
            f"{enrichment_api_url}/executives",
            json={
                "company":      company_name,
                "domain":       company_domain,
                "targetTitles": target_titles,
            },
            headers={"X-API-Key": os.environ.get("ENRICHMENT_API_KEY", "")},
            timeout=10,
        )
        if resp.status_code == 200:
            return {"executives": resp.json().get("executives", []), "source": "enrichment_api"}
    except Exception:
        pass

    return {"executives": [], "source": "lookup_failed"}


@tool
def verify_email(email_address: str, company_domain: str) -> dict:
    """
    Verify whether an email address is deliverable using a third-party
    email-verification API (Hunter.io/ZeroBounce-class service).

    This is step 4d in the Phase 2A v3 waterfall: the hypothesised address
    is verified before it is written to the CRM. An unverified address is
    either discarded or written with an explicit low-confidence flag.

    Per v3 §Phase 2, 2C: if the contact's email is low-confidence/unverified,
    the Outreach Agent's checkpoint frequency automatically tightens for that send.

    Returns:
      { status: 'verified'|'risky'|'invalid'|'unknown',
        confidence: 0.0-1.0, deliverable: bool }
    """
    verification_api_url = os.environ.get("EMAIL_VERIFICATION_API_URL", "")
    verification_api_key = os.environ.get("EMAIL_VERIFICATION_API_KEY", "")

    if not verification_api_url:
        # Stub: return unknown if API not configured (won't block enrichment)
        return {"status": "unknown", "confidence": 0.5, "deliverable": False,
                "note": "Verification API not configured — set EMAIL_VERIFICATION_API_URL"}

    try:
        resp = httpx.get(
            f"{verification_api_url}/verify",
            params={"email": email_address},
            headers={"Authorization": f"Bearer {verification_api_key}"},
            timeout=8,
        )
        if resp.status_code == 200:
            data    = resp.json()
            status  = data.get("status", "unknown")
            score   = float(data.get("score", 0.5))
            is_ok   = status in ("valid", "verified") and score >= 0.7
            return {"status": status, "confidence": score, "deliverable": is_ok}
    except Exception:
        pass

    return {"status": "unknown", "confidence": 0.0, "deliverable": False}
