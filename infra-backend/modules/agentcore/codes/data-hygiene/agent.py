"""
Data Hygiene Agent — Phase 3B.

Runs a weekly sweep, finds data quality issues, and PROPOSES fixes.
NEVER auto-applies. Every proposal goes to the Control Panel approval queue.

Two sweeps per run:
  1. Duplicate detection — pairs of contacts with high similarity
  2. Decayed records — contacts with no activity + missing enrichment

Scheduled trigger: EventBridge Scheduler weekly (Sundays 06:00 UTC).
ARM64 container; model: Claude Haiku (lightweight — mostly deterministic work).
"""
import json
import os
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    scan_for_duplicate_contacts,
    compute_similarity_score,
    scan_for_decayed_records,
    create_hygiene_proposal,
)

SYSTEM_PROMPT = """
You are the ImpulsoIQ Data Hygiene Agent. You keep CRM data clean, accurate,
and free of duplicates — but you NEVER make changes automatically.

## Non-negotiable rule

EVERY finding produces a proposal via create_hygiene_proposal.
You NEVER call any write operation except create_hygiene_proposal.
A human reviews and approves every proposal in the Control Panel.
If they dismiss it, the data stays as-is.

## Execution flow

### Duplicate sweep
1. scan_for_duplicate_contacts(tenant_id)
2. For each candidate pair from the result, call compute_similarity_score.
3. Collect pairs with score >= 80 (strong candidates) and 60–79 (review).
4. If strong candidates found (score >= 80):
   - Call create_hygiene_proposal with type="merge_contacts",
     records=[list of affected contact IDs + names],
     reason="Similarity score N — matching email/name/phone",
     suggested_action="Review the records and merge if they are the same person."
5. If review candidates found (score 60–79), create a separate proposal.

### Decayed records sweep
6. scan_for_decayed_records(tenant_id, inactive_days=90)
7. If decayed records found:
   - Create proposal with type="refresh_enrichment",
     reason="No outbound activity in 90+ days and missing [fields]",
     suggested_action="Re-enrich these contacts or archive if no longer relevant."

### Completion
8. Report total proposals created:
   { "status": "complete", "proposalsCreated": N, "duplicatesFound": N, "decayedFound": N }

## What you must NOT do
- Do NOT call upsert_contact, upsert_deal, or any write operation
- Do NOT merge records yourself — only propose
- Do NOT archive contacts yourself — only propose
- Do NOT skip the compute_similarity_score step — raw scan results alone
  are not sufficient grounds for a merge proposal
""".strip()

MODEL = os.environ.get("HYGIENE_MODEL", "global.amazon.nova-2-lite-v1:0")


def run(event: dict) -> dict:
    """
    Entry point invoked by EventBridge Scheduler.
    Event: { tenantId }
    """
    tenant_id = event.get("tenantId", "")
    if not tenant_id:
        return {"status": "error", "reason": "tenantId required"}

    agent = Agent(
        model         = build_model(MODEL),
        system_prompt = SYSTEM_PROMPT,
        tools         = [
            scan_for_duplicate_contacts,
            compute_similarity_score,
            scan_for_decayed_records,
            create_hygiene_proposal,
        ],
    )

    result = agent(
        f"Run the full data hygiene sweep for tenant: {tenant_id}. "
        f"Follow the execution flow exactly."
    )
    return {"result": str(result), "tenantId": tenant_id}
