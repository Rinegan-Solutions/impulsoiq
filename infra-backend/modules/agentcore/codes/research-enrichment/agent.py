"""
Research & Enrichment Agent — Phase 4 waterfall.

The paid lookup order is code, not model judgment: internal history →
providers A/B/C → email verify. Cap four paid HTTP calls. No placeholder
industry/headcount when providers are missing.
"""
import json
import os
from impulsoiq_model import build_model
from strands import Agent
from .tools import (
    execute_waterfall,
    get_brand_voice_profile,
    run_enrichment_waterfall,
    write_to_memory,
)

MODEL = os.environ.get("ENRICHMENT_MODEL", "global.amazon.nova-2-lite-v1:0")


def run(event: dict) -> dict:
    tenant_id  = event.get("tenantId", "")
    contact_id = event.get("contactId", "")
    waterfall = execute_waterfall(tenant_id, contact_id)
    if not waterfall.get("ok"):
        return {
            "ok": False,
            "gap": waterfall.get("gap"),
            "message": waterfall.get("message"),
            "paidCalls": waterfall.get("paidCalls", 0),
            "tenantId": tenant_id,
            "contactId": contact_id,
            "verifiedEmail": False,
        }

    try:
        agent = Agent(
            model=build_model(MODEL),
            system_prompt=(
                "Write one-sentence personalisation_hints using ONLY the attributed "
                "fields you are given. Do not invent industry, headcount, or email status."
            ),
            tools=[run_enrichment_waterfall, get_brand_voice_profile, write_to_memory],
        )
        agent(
            f"Attributed fields: {json.dumps(waterfall)}\n"
            f"Tenant {tenant_id} contact {contact_id}. Call write_to_memory with a brief."
        )
    except Exception:
        pass

    return {
        "ok": True,
        "gap": None,
        "verifiedEmail": bool(waterfall.get("verifiedEmail")),
        "paidCalls": waterfall.get("paidCalls", 0),
        "tenantId": tenant_id,
        "contactId": contact_id,
        "fields": waterfall.get("fields", []),
    }
