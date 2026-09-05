"""
Bedrock model construction, shared by every ImpulsoIQ agent.

WHY THIS EXISTS
Each agent used to pass a bare model-id string to `Agent(model=...)`, which
gives Strands a BedrockModel with default settings. That silently lost the
single most important model decision in both implementation plans: Nova 2 Lite
with extended thinking at MEDIUM reasoning effort. "Medium thinking" appeared in
five agent docstrings and in zero API calls, so every agent was running at
default effort while the cost projections priced a configuration that was never
deployed.

Extended thinking is set through the Converse API's additionalModelRequestFields:

    "reasoningConfig": { "type": "enabled", "maxReasoningEffort": "medium" }

ONE CONSTRAINT WORTH KNOWING
At maxReasoningEffort "high", Nova 2 rejects maxTokens, temperature, topP and
topK — a request carrying any of them errors. "medium" has no such restriction,
which is part of why it is the roster default rather than a compromise.

REGION
Nova 2 Lite is reachable in eu-west-2 only through the global inference profile
(global.amazon.nova-2-lite-v1:0); there is no regional eu-west-2 Nova profile.
Nova Sonic is not available in ANY EU region, so the ambient voice path has to
name its own region explicitly — see AMBIENT_VOICE_REGION.
"""
from __future__ import annotations

import os
from typing import Any

# Strands has moved this symbol between minor versions; try both paths rather
# than pinning the agents to one layout.
try:  # strands-agents >= 0.2
    from strands.models import BedrockModel  # type: ignore
except ImportError:  # pragma: no cover - older layout
    from strands.models.bedrock import BedrockModel  # type: ignore

# low | medium | high. Overridable per environment so a cost or latency problem
# is a deployment change, not a code change.
DEFAULT_REASONING_EFFORT = os.environ.get("BEDROCK_REASONING_EFFORT", "medium")

# Where the agent's own model lives. Agents run in eu-west-2 and AWS_REGION is
# set by the runtime, so this is only overridden for the voice path.
DEFAULT_REGION = os.environ.get("AWS_REGION", "eu-west-2")


def reasoning_config(effort: str | None = None) -> dict[str, Any]:
    """The additionalModelRequestFields payload that turns on extended thinking."""
    return {
        "reasoningConfig": {
            "type": "enabled",
            "maxReasoningEffort": (effort or DEFAULT_REASONING_EFFORT),
        }
    }


def build_model(
    model_id: str,
    *,
    region: str | None = None,
    reasoning_effort: str | None = None,
) -> BedrockModel:
    """
    Build the BedrockModel an Agent should run on.

    Every agent calls this instead of passing a raw id, so extended thinking is
    on by construction rather than by each agent remembering to configure it.
    """
    return BedrockModel(
        model_id=model_id,
        region_name=(region or DEFAULT_REGION),
        additional_request_fields=reasoning_config(reasoning_effort),
    )
