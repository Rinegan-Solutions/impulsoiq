"""
Data Hygiene Agent — tool definitions (Phase 3B).

Key rule: NEVER auto-apply. Every proposal lands in the Control Panel
          approval queue for a human to confirm or dismiss.

Tool sequence:
  1. scan_for_duplicate_contacts  — DSQL fuzzy match (deterministic)
  2. compute_similarity_score     — per-pair deterministic scoring
  3. scan_for_decayed_records     — contacts with no recent activity
  4. create_hygiene_proposal      — writes to approval queue via CRM Write Service
"""
import json
import os
import re
import boto3
from strands import tool

_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _crm_read(operation: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_READ_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({"operation": operation, "payload": payload, "tenantId": tenant_id}).encode(),
    )
    return json.loads(resp["Payload"].read())


def _crm_write(operation: str, payload: dict, tenant_id: str) -> dict:
    resp = _lambda.invoke(
        FunctionName   = os.environ["CRM_WRITE_SERVICE_ARN"],
        InvocationType = "RequestResponse",
        Payload        = json.dumps({
            "operation": operation, "payload": payload, "tenantId": tenant_id,
            "actorType": "agent", "actorId": "data-hygiene-agent",
        }).encode(),
    )
    return json.loads(resp["Payload"].read())


@tool
def scan_for_duplicate_contacts(tenant_id: str) -> dict:
    """
    Find potential duplicate contacts using DSQL query (exact email match or
    same first+last name). Returns pairs of candidate duplicates.

    DETERMINISTIC: SQL equality + case-insensitive name comparison. NOT LLM.
    Threshold: any pair with matching email OR matching full name.
    """
    return _crm_read("scan_for_duplicates", {"entityType": "contact"}, tenant_id)


@tool
def compute_similarity_score(record_a: dict, record_b: dict) -> dict:
    """
    Compute a 0–100 similarity score between two contact records.

    DETERMINISTIC scoring — no LLM involvement:
    - Exact email match:           +60 points
    - Same email domain:           +10 points
    - Same first + last name:      +40 points
    - Same first name only:        +15 points
    - Same phone (normalised):     +30 points
    - Same company name:           +10 points

    Score >= 80 → strong merge candidate
    Score 60–79 → review candidate
    Score < 60  → unlikely duplicate (skip)
    """
    score      = 0
    breakdown  = {}

    email_a = (record_a.get("email") or "").lower().strip()
    email_b = (record_b.get("email") or "").lower().strip()
    if email_a and email_b:
        if email_a == email_b:
            score += 60
            breakdown["exact_email"] = 60
        elif email_a.split("@")[-1] == email_b.split("@")[-1]:
            score += 10
            breakdown["same_domain"] = 10

    first_a = (record_a.get("firstName") or record_a.get("first_name") or "").lower().strip()
    first_b = (record_b.get("firstName") or record_b.get("first_name") or "").lower().strip()
    last_a  = (record_a.get("lastName")  or record_a.get("last_name")  or "").lower().strip()
    last_b  = (record_b.get("lastName")  or record_b.get("last_name")  or "").lower().strip()
    if first_a and first_a == first_b and last_a and last_a == last_b:
        score += 40
        breakdown["same_full_name"] = 40
    elif first_a and first_a == first_b:
        score += 15
        breakdown["same_first_name"] = 15

    def normalise_phone(p: str) -> str:
        return re.sub(r"[^\d]", "", p or "")

    phone_a = normalise_phone(record_a.get("phone", ""))
    phone_b = normalise_phone(record_b.get("phone", ""))
    if phone_a and phone_b and len(phone_a) >= 7 and phone_a == phone_b:
        score += 30
        breakdown["same_phone"] = 30

    company_a = (record_a.get("company") or "").lower().strip()
    company_b = (record_b.get("company") or "").lower().strip()
    if company_a and company_a == company_b:
        score += 10
        breakdown["same_company"] = 10

    verdict = "strong" if score >= 80 else "review" if score >= 60 else "unlikely"
    return {"score": score, "verdict": verdict, "breakdown": breakdown}


@tool
def scan_for_decayed_records(tenant_id: str, inactive_days: int = 90) -> dict:
    """
    Find contacts with no outbound activity in the last inactive_days days
    AND missing critical enrichment fields (email, title, or company).

    These are candidates for re-enrichment or archival.
    DETERMINISTIC: date arithmetic query via CRM read.
    """
    return _crm_read("list_decayed_enrichment", {}, tenant_id)


@tool
def create_hygiene_proposal(
    tenant_id:     str,
    proposal_type: str,
    records:       list,
    reason:        str,
    suggested_action: str,
) -> dict:
    """
    Create a hygiene proposal in the Control Panel approval queue.

    CRITICAL: This tool PROPOSES. It NEVER applies changes.
    A human must confirm or dismiss every proposal in the Control Panel.

    proposal_type:   'merge_contacts' | 'refresh_enrichment' | 'archive_contacts'
    records:         list of { id, name, ... } records affected
    reason:          why this proposal was generated (for the human reviewer)
    suggested_action: what the human can do to resolve this

    The proposal is written as an activity record with status='awaiting_approval'
    and routed to the Control Panel approval queue via AppSync.
    """
    if len(records) == 0:
        return {"ok": False, "error": "No records provided for hygiene proposal"}

    proposal_body = json.dumps({
        "proposalType":    proposal_type,
        "records":         records[:10],  # cap at 10 per proposal for readability
        "reason":          reason,
        "suggestedAction": suggested_action,
        "recordCount":     len(records),
    })

    # Write as a 'note' activity — Control Panel queries activities with
    # actor_type='agent' and metadata.requiresApproval=true for the approval queue
    result = _crm_write(
        "upsert_activity",
        {
            "type":      "note",
            "actorType": "agent",
            "actorId":   "data-hygiene-agent",
            "subject":   f"Hygiene proposal: {proposal_type} ({len(records)} records)",
            "body":      proposal_body,
            "metadata":  {
                "requiresApproval": True,
                "proposalType":     proposal_type,
                "recordCount":      len(records),
                "status":           "awaiting_approval",
            },
        },
        tenant_id,
    )
    return {**result, "proposalType": proposal_type, "recordCount": len(records)}
