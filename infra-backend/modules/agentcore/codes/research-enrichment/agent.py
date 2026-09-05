"""
Research & Enrichment Agent — Phase 2A (updated in v3).

Four-step waterfall (v3 adds step 4: executive mapping & email verification):
  1. Internal history (CRM) — check what we already know
  2. Licensed enrichment API — firmographic / technographic data
  3. Browser tool — company's own public pages (no LinkedIn scraping)
  4. NEW v3: Executive mapping + email verification (step 4a-4e in v3 spec)
  5. Deterministic ICP fit scoring (Code Interpreter, not LLM guess)
  6. Write result to CRM via CRM Write Service

SOURCE RULE (v3): Executive names come from the licensed enrichment provider
ONLY. The Browser tool is NEVER directed at LinkedIn profiles or search.
If no verified contact is found, surface the gap to the human — never fall
back to scraping.

ARM64 container; model: Nova 2 Lite, medium thinking (v3 §5.2 default).
"""
import json
import os
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    get_internal_history,
    get_brand_voice_profile,
    enrich_from_api,
    compute_fit_score,
    write_enrichment_result,
    write_to_memory,
    map_executives,
    verify_email,
)

SYSTEM_PROMPT = """
You are the ImpulsoIQ Research & Enrichment agent (v3). Your job is to build a
complete, accurate, VERIFIED profile for a contact so the Outreach agent can
craft a highly personalised, relevant email or call.

## Four-step waterfall — you MUST follow this exact order

1. Call get_internal_history first. If the contact already has enrichment_json
   with a score >= 50 and data less than 7 days old AND a verified email, skip
   steps 2–4 and proceed to scoring.

2. Call enrich_from_api to fetch firmographic data (industry, headcount, revenue,
   tech stack). Do this even if internal history exists — fresh data preferred.

3. (NEW v3) Executive mapping + contact verification:
   a. Call map_executives with the company domain and target titles (VP Sales,
      CRO, CMO, Director of Ops — whatever fits the campaign ICP).
      IMPORTANT: map_executives uses the licensed enrichment provider ONLY.
      NEVER instruct the Browser tool to visit LinkedIn profiles or search.
      If map_executives returns no result, write { "exec_mapping": "no_verified_contact" }
      and proceed — do NOT try alternative lookup methods that involve scraping.
   b. For each executive returned, hypothesize the email from the domain pattern.
   c. Call verify_email for each hypothesized address.
   d. Write ONLY verified/deliverable addresses as high-confidence contacts.
      Unverified addresses get { "email_confidence": "low" } — the Outreach
      agent will route these to forced human review before sending.

4. Call compute_fit_score. SCORING IS DETERMINISTIC — use this tool every time.
   The contact-verification status (verified/unverified) is an input to the score.

5. Call write_enrichment_result to persist all data including verification status.

6. Call write_to_memory with a contact brief for semantic recall by later agents.

7. (Optional) Call get_brand_voice_profile for personalisation_hints.

## Source rules (v3 permanent constraints)

- Executive names: licensed enrichment provider ONLY. Never LinkedIn scraping.
- Browser tool: only for company's own public pages (leadership page, press releases,
  job listings for growth-signal detection). Never for any gated or login-required site.
- If no verified contact found: surface the gap with { "exec_mapping": "no_verified_contact" }
  rather than falling back to unverified guesses.

## Rules — strictly enforced

- SCORING IS DETERMINISTIC: compute_fit_score only. Never guess.
- EMAIL CONFIDENCE: unverified → low-confidence flag → Outreach agent will
  force human review before that email is sent.
- SINGLE WRITER: write_enrichment_result only for persistence.
- LOW FIT: score < 30 → include { "recommend_disqualify": true }.
- ERROR HANDLING: enrich_from_api error → proceed with internal data only,
  set enrichment_json.api_enrichment_failed = true.

## Output format

When done, respond with JSON:
{
  "contactId": "<id>",
  "score": <int>,
  "verdict": "high|medium|low",
  "enrichmentSummary": "<one sentence>",
  "recommendDisqualify": <bool>
}
""".strip()

# v3 §5.2: Nova 2 Lite with medium thinking is the default model for this agent
MODEL = os.environ.get("ENRICHMENT_MODEL", "global.amazon.nova-2-lite-v1:0")


def run(event: dict) -> dict:
    """
    Entry point invoked by:
    - Step Functions (EnrichContact state) — event: {tenantId, contactId, campaignId, icpCriteria?}
    - Coordinator agent (direct delegation)

    Returns: {score, verdict, contactId, enrichmentSummary, recommendDisqualify}
    """
    agent = Agent(
        model=build_model(MODEL),
        system_prompt=SYSTEM_PROMPT,
        tools=[
            get_internal_history,
            get_brand_voice_profile,
            enrich_from_api,
            compute_fit_score,
            write_enrichment_result,
            write_to_memory,
            # v3 step 4: executive mapping + email verification
            map_executives,
            verify_email,
        ],
    )

    tenant_id  = event.get("tenantId", "")
    contact_id = event.get("contactId", "")
    campaign_id = event.get("campaignId", "")
    icp_criteria = event.get("icpCriteria", {
        "industries":    ["Technology", "SaaS", "Software"],
        "employee_range": {"min": 10, "max": 5000},
        "seniorities":   ["Director", "VP", "C-Level", "Manager"],
        "technologies":  ["Salesforce", "HubSpot", "Marketo"],
        "revenue_bands": ["1M-10M", "10M-50M", "50M-200M"],
    })

    prompt = (
        f"Enrich the contact and compute their ICP fit score.\n"
        f"Tenant ID:    {tenant_id}\n"
        f"Contact ID:   {contact_id}\n"
        f"Campaign ID:  {campaign_id}\n"
        f"ICP criteria: {json.dumps(icp_criteria)}\n\n"
        f"Follow the enrichment waterfall exactly as described in your instructions."
    )

    result = agent(prompt)
    return {"result": str(result), "tenantId": tenant_id, "contactId": contact_id}
