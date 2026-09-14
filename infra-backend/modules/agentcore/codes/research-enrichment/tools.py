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
from impulsoiq_secrets import app_secret

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
    Single-provider lookup. Prefer run_enrichment_waterfall, which caps paid
    calls and never invents firmographics.
    """
    return _provider_call("A", contact_email, contact_domain)


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
            headers={"X-API-Key": os.environ.get("ENRICHMENT_API_KEY", "") or app_secret("enrichment_api_key")},
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
    verification_api_key = os.environ.get("EMAIL_VERIFICATION_API_KEY", "") or app_secret("email_verification_api_key")

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


def _providers() -> list[tuple[str, str, str]]:
    """(id, url, key) for A then B then C. A aliases the legacy ENRICHMENT_API_* vars."""
    specs = [
        ("A", os.environ.get("ENRICHMENT_PROVIDER_A_URL") or os.environ.get("ENRICHMENT_API_URL", ""),
         os.environ.get("ENRICHMENT_PROVIDER_A_KEY") or os.environ.get("ENRICHMENT_API_KEY", ""),
         "enrichment_api_key"),
        ("B", os.environ.get("ENRICHMENT_PROVIDER_B_URL", ""),
         os.environ.get("ENRICHMENT_PROVIDER_B_KEY", ""),
         "enrichment_provider_b_key"),
        ("C", os.environ.get("ENRICHMENT_PROVIDER_C_URL", ""),
         os.environ.get("ENRICHMENT_PROVIDER_C_KEY", ""),
         "enrichment_provider_c_key"),
    ]
    out: list[tuple[str, str, str]] = []
    for pid, url, key, secret_name in specs:
        if not url:
            continue
        out.append((pid, url, (key or "").strip() or app_secret(secret_name)))
    return out


def _provider_call(provider_id: str, email: str, domain: str) -> dict:
    for pid, url, key in _providers():
        if pid != provider_id:
            continue
        try:
            resp = httpx.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"email": email, "domain": domain},
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json() if resp.content else {}
            if not isinstance(data, dict):
                return {"error": "non_object_response", "source": pid}
            data["source"] = pid
            return data
        except Exception as exc:
            return {"error": str(exc), "source": pid}
    return {"error": "provider_not_configured", "source": provider_id}


def _decayed(fetched_at: str | None, policy: str) -> bool:
    if not fetched_at:
        return True
    days = 90
    if policy.endswith("d"):
        try:
            days = int(policy[:-1])
        except ValueError:
            days = 90
    from datetime import datetime, timezone
    try:
        fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    now = datetime.now(timezone.utc)
    return (now - fetched).days > days


def _row_verified_email(row: dict) -> bool:
    if not row:
        return False
    try:
        conf = float(row.get("confidence") or 0)
    except (TypeError, ValueError):
        return False
    if conf < 0.8:
        return False
    meta = row.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    status = str(meta.get("status") or meta.get("verificationStatus") or "")
    if row.get("field") == "email_verified":
        return not _decayed(row.get("fetched_at") or row.get("fetchedAt"), row.get("decay_policy") or row.get("decayPolicy") or "30d")
    if status not in ("verified", "valid", "deliverable"):
        return False
    return not _decayed(row.get("fetched_at") or row.get("fetchedAt"), row.get("decay_policy") or row.get("decayPolicy") or "30d")


def _fields_from_provider(data: dict) -> list[tuple[str, str, float]]:
    """Only copy keys the provider actually returned. Never invent industry/headcount."""
    mapping = {
        "industry": "industry",
        "employee_count": "employee_count",
        "employeeCount": "employee_count",
        "company_name": "company_name",
        "companyName": "company_name",
        "revenue_band": "revenue_band",
        "revenueBand": "revenue_band",
        "seniority": "seniority",
        "job_function": "job_function",
        "email": "email",
        "title": "title",
    }
    out: list[tuple[str, str, float]] = []
    conf = float(data.get("confidence") or 0.6)
    if data.get("error"):
        return out
    for src, field in mapping.items():
        if data.get(src) in (None, "", []):
            continue
        out.append((field, str(data[src]), conf))
    tech = data.get("tech_stack") or data.get("techStack")
    if isinstance(tech, list) and tech:
        out.append(("tech_stack", ",".join(str(t) for t in tech), conf))
    return out


@tool
def run_enrichment_waterfall(tenant_id: str, contact_id: str) -> dict:
    """
    Deterministic waterfall: internal history → providers A/B/C → email verify.
    Stops at the first high-confidence verified email. Cap: four paid HTTP calls.
    Production without providers returns a human-visible gap — never placeholders.
    """
    return execute_waterfall(tenant_id, contact_id)


def execute_waterfall(tenant_id: str, contact_id: str) -> dict:
    crm_read = os.environ["CRM_READ_SERVICE_ARN"]
    crm_write = os.environ["CRM_WRITE_SERVICE_ARN"]
    contact_wrap = _invoke_lambda(crm_read, {
        "operation": "get_contact",
        "payload": {"id": contact_id},
        "tenantId": tenant_id,
    })
    contact = contact_wrap.get("result") or {}
    if not contact:
        return {"ok": False, "gap": "contact_not_found", "paidCalls": 0}

    hist = _invoke_lambda(crm_read, {
        "operation": "list_enrichment_records",
        "payload": {"contactId": contact_id},
        "tenantId": tenant_id,
    })
    existing = hist.get("result") or []
    if not isinstance(existing, list):
        existing = []

    for row in existing:
        if _row_verified_email(row if isinstance(row, dict) else {}):
            return {
                "ok": True,
                "gap": None,
                "verifiedEmail": True,
                "paidCalls": 0,
                "source": "internal_history",
                "contactId": contact_id,
            }

    providers = _providers()
    verify_url = os.environ.get("EMAIL_VERIFICATION_API_URL", "")
    if not providers and not verify_url:
        return {
            "ok": False,
            "gap": "no_enrichment_providers",
            "message": "No enrichment or email-verification providers are configured. Outbound will not invent industry or headcount.",
            "paidCalls": 0,
            "contactId": contact_id,
        }

    paid = 0
    records: list[dict] = []
    email_candidate = (contact.get("email") or "").strip()
    domain = (contact.get("email") or "").split("@")[-1] if contact.get("email") else ""
    verified = False

    for pid, url, key in providers:
        if paid >= 4:
            break
        paid += 1
        data = _provider_call(pid, email_candidate, domain)
        for field, value, conf in _fields_from_provider(data):
            records.append({
                "contactId": contact_id,
                "source": f"provider_{pid}",
                "field": field,
                "value": value,
                "confidence": conf,
                "decayPolicy": "30d" if field in ("email", "email_verified") else "90d",
                "metadata": {},
            })
            if field == "email" and value:
                email_candidate = value
        if any(r["field"] == "email" and float(r["confidence"]) >= 0.8 for r in records):
            break

    if email_candidate and verify_url and paid < 4:
        paid += 1
        vr = verify_email(email_candidate, domain)
        deliverable = bool(vr.get("deliverable"))
        conf = float(vr.get("confidence") or 0)
        verified = deliverable and conf >= 0.7
        records.append({
            "contactId": contact_id,
            "source": "email_verify",
            "field": "email_verified" if verified else "email",
            "value": email_candidate,
            "confidence": conf if verified else min(conf, 0.49),
            "decayPolicy": "30d",
            "metadata": {"status": vr.get("status"), "paid": True},
        })
    elif email_candidate and not verify_url:
        records.append({
            "contactId": contact_id,
            "source": "unverified",
            "field": "email",
            "value": email_candidate,
            "confidence": 0.2,
            "decayPolicy": "30d",
            "metadata": {"status": "unverified", "reason": "verification_api_not_configured"},
        })

    if records:
        _invoke_lambda(crm_write, {
            "operation": "insert_enrichment_records",
            "payload": {"contactId": contact_id, "records": records},
            "tenantId": tenant_id,
            "actorType": "agent",
            "actorId": "research-enrichment-agent",
        })

    summary = {r["field"]: r["value"] for r in records}
    if summary:
        _invoke_lambda(crm_write, {
            "operation": "upsert_contact",
            "payload": {
                "id": contact_id,
                "enrichmentJson": {
                    **summary,
                    "email_confidence": "high" if verified else "low",
                    "verifiedEmail": verified,
                    "waterfallPaidCalls": paid,
                },
            },
            "tenantId": tenant_id,
            "actorType": "agent",
            "actorId": "research-enrichment-agent",
        })

    return {
        "ok": bool(verified or summary),
        "gap": None if (verified or summary) else "no_attributed_fields",
        "verifiedEmail": verified,
        "paidCalls": paid,
        "contactId": contact_id,
        "fields": list(summary.keys()),
        "message": None if (verified or summary) else "Providers returned no attributed fields.",
    }
