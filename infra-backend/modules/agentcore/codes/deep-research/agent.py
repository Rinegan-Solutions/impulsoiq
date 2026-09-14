"""
Deep Research Agent — Phase 4B (Swarm topology).

The ONLY place in the entire system where Swarm orchestration is used.
All other agents use Graph topology (deterministic).

Architecture:
  Coordinator detects a fuzzy goal → cost estimate presented → user approves
  → 4 research sub-agents run IN PARALLEL with distinct strategies:
       firmographic   — companies with similar revenue/headcount/industry
       technographic  — companies using similar tech stack
       news_signals   — companies with recent funding/hiring/growth signals
       lookalike      — companies similar to our historical closed-won deals
  → Each sub-agent writes findings to session-scoped DynamoDB memory
  → Synthesis coordinator reads all findings and produces ranked output

COST GOVERNANCE (Phase 3C dependency):
  - Swarm runs are BUDGET-CAPPED
  - Require EXPLICIT APPROVAL before starting (event.approved must be True)
  - check_metering_quota called before spawning any sub-agent
  - Total estimated cost is shown to the user before they approve

ARM64 container; model: Claude Sonnet (configurable via DEEP_RESEARCH_MODEL env var).
"""
import json
import os
import uuid
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    get_closed_won_profiles,
    search_public_signals,
    read_session_memory,
    write_to_session_memory,
    write_research_report,
)

MODEL = os.environ.get("DEEP_RESEARCH_MODEL", "global.amazon.nova-2-lite-v1:0")

# Estimated token cost per sub-agent run (for pre-approval cost display)
TOKENS_PER_SUBAGENT   = 8_000
NUM_SUBAGENTS         = 4
SYNTHESIS_TOKENS      = 5_000
TOTAL_ESTIMATED_TOKENS = NUM_SUBAGENTS * TOKENS_PER_SUBAGENT + SYNTHESIS_TOKENS

# ── Sub-agent strategy prompts ─────────────────────────────────────────────────

STRATEGY_CONFIGS = {
    "firmographic": {
        "description": "Companies with similar revenue, headcount, industry, and business model",
        "system_prompt": """
You are a firmographic research specialist. Find companies that match our ideal customer
profile based on revenue range, employee count, industry, and business stage.

Use get_closed_won_profiles to understand our best customers. If profiles
are empty, treat the research goal itself as the ICP. Then ALWAYS call
search_public_signals. Write every returned company to session memory.

Output 5-8 high-confidence company matches with specific reasons why each fits.
Never invent a company that was not in tool results.
""".strip(),
    },
    "technographic": {
        "description": "Companies using similar technology stacks or facing similar tech challenges",
        "system_prompt": """
You are a technographic research specialist. Find companies that use similar technologies
or face the same operational challenges as our best customers.

Use get_closed_won_profiles for tech context. If it is empty, search from
the research goal. Then ALWAYS call search_public_signals with technographic
queries. Write every returned company to session memory.

Output 5-8 matches with specific technology signals for each.
Never invent a company that was not in tool results.
""".strip(),
    },
    "news_signals": {
        "description": "Companies with recent funding, hiring, or growth signals indicating buying intent",
        "system_prompt": """
You are a signals-based research specialist. Find companies with recent positive signals:
Series A/B funding, rapid hiring in sales/engineering, new product launches, or
expansion announcements — these indicate active buying intent and budget availability.

Use search_public_signals with news and signal queries. Write every returned
company to session memory even if other tools reported a gap.

Output 5-8 matches with specific signal events and recency.
Never invent a company that was not in tool results.
""".strip(),
    },
    "lookalike": {
        "description": "Companies that closely resemble our historical closed-won deals",
        "system_prompt": """
You are a lookalike modelling specialist. Identify companies that most closely resemble
the profile of deals we have already closed and won — use our closed-won deal history
as the gold standard and find companies with the highest pattern similarity.

Use get_closed_won_profiles as the baseline. If it is empty, use accounts
in the workspace and the research goal as the pattern, then still call
search_public_signals. Write every returned company to session memory.

Output 5-8 ranked lookalike matches with similarity score and reasoning.
Never invent a company that was not in tool results.
""".strip(),
    },
}


def run_sub_agent(
    strategy:   str,
    config:     dict,
    goal:       str,
    tenant_id:  str,
    session_id: str,
) -> dict:
    """
    Execute one research sub-agent with a specific strategy.
    Called in parallel by the Swarm coordinator via ThreadPoolExecutor.
    """
    agent = Agent(
        model         = build_model(MODEL),
        system_prompt = config["system_prompt"],
        tools         = [
            get_closed_won_profiles,
            search_public_signals,
            write_to_session_memory,
        ],
    )

    prompt = (
        f"Research goal: {goal}\n"
        f"Strategy: {config['description']}\n"
        f"Tenant ID: {tenant_id}\n"
        f"Session ID: {session_id}\n\n"
        f"Use your tools. Write findings to session memory with strategy='{strategy}'."
    )

    try:
        result = agent(prompt)
        return {"strategy": strategy, "status": "complete", "result": str(result)}
    except Exception as e:
        return {"strategy": strategy, "status": "failed", "error": str(e)}


def run(event: dict) -> dict:
    """
    Entry point invoked by the Coordinator or a direct API trigger.

    REQUIRES event.approved = True — this check prevents the Swarm from running
    without explicit user confirmation of the cost estimate.

    Event shape:
      { tenantId, goal, approved, sessionId?, estimatedCostTokens?, userId? }
    """
    tenant_id = event.get("tenantId", "")
    goal      = event.get("goal", "")
    approved  = event.get("approved", False)

    # HARD GATE: Swarm requires explicit approval — no exceptions
    if not approved:
        return {
            "status": "awaiting_approval",
            "estimatedTokens": TOTAL_ESTIMATED_TOKENS,
            "estimatedCostUsd": round(TOTAL_ESTIMATED_TOKENS * 0.000003, 4),
            "strategies": list(STRATEGY_CONFIGS.keys()),
            "message": (
                f"This Swarm research will use approximately {TOTAL_ESTIMATED_TOKENS:,} tokens "
                f"(~${TOTAL_ESTIMATED_TOKENS * 0.000003:.4f}). "
                f"Re-submit with approved=True to proceed."
            ),
        }

    session_id = event.get("sessionId") or f"swarm-{uuid.uuid4().hex[:8]}"
    started_at = datetime.datetime.utcnow().isoformat() + "Z"

    # ── Run 4 sub-agents in PARALLEL (Swarm pattern) ──────────────────────────
    sub_results = []
    with ThreadPoolExecutor(max_workers=NUM_SUBAGENTS) as executor:
        futures = {
            executor.submit(
                run_sub_agent,
                strategy, config, goal, tenant_id, session_id
            ): strategy
            for strategy, config in STRATEGY_CONFIGS.items()
        }
        for future in as_completed(futures):
            sub_results.append(future.result())

    # ── Synthesis coordinator: read all findings and produce ranked output ────
    synthesis_agent = Agent(
        model         = build_model(MODEL),
        system_prompt = """
You are the synthesis coordinator for a multi-strategy Swarm research run.
Read the session memory containing findings from 4 specialist sub-agents, then
produce a single ranked, deduplicated, sourced output.

Ranking criteria:
1. Companies found by multiple strategies rank higher (convergent signal)
2. Within a strategy, higher confidence findings rank higher
3. Include the strategies that surfaced each company so the user understands provenance

If some strategies wrote empty findings because of a gap, still rank every
company that DID come back. Do not conclude "0 companies" when session memory
contains any company_name.

Output a ranked list of 10-15 companies with:
  { rank, company, reasons: list, strategies: list, confidence }

Then call write_research_report to persist the output.
Never invent companies that were not in session memory.
""".strip(),
        tools = [read_session_memory, write_research_report],
    )

    synthesis_prompt = (
        f"Synthesise the Swarm research results.\n"
        f"Tenant ID:  {tenant_id}\n"
        f"Session ID: {session_id}\n"
        f"Goal:       {goal}\n\n"
        f"Sub-agent statuses: {json.dumps([r['strategy'] + '=' + r['status'] for r in sub_results])}\n\n"
        f"Read session memory, rank results, call write_research_report."
    )

    synthesis_result = synthesis_agent(synthesis_prompt)

    return {
        "status":      "complete",
        "sessionId":   session_id,
        "goal":        goal,
        "tenantId":    tenant_id,
        "startedAt":   started_at,
        "completedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "subAgentResults": sub_results,
        "synthesis":   str(synthesis_result),
    }
