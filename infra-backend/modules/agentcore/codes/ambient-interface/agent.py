"""
Ambient Interface Agent — Phase 4A.

Lets the professional talk to ImpulsoIQ. Speech-to-speech uses Strands
BidiAgent + Nova Sonic on AgentCore /ws. Typed fallback still uses a
normal Strands Agent on POST /invocations.

This is distinct from the Voice Agent (Phase 2), which calls other people.
"""
from __future__ import annotations

import os

from strands import Agent
from strands.experimental.bidi.agent import BidiAgent

try:
    from strands.experimental.bidi.models.nova_sonic import BidiNovaSonicModel as SonicModel
except ImportError:
    from strands.experimental.bidi.models import BedrockNovaSonicModel as SonicModel

from impulsoiq_model import build_model
from .tools import (
    approve_item,
    get_morning_briefing,
    list_pending_approvals,
    query_call_result,
    query_pipeline_status,
    session_tools,
    submit_goal,
)

SYSTEM_PROMPT = """
You are ImpulsoIQ's ambient voice assistant. You are having a real-time voice
conversation with a sales professional. They are using you hands-free, often
between meetings or while on the go.

## Communication style (voice-first)

- Responses must be SHORT and speakable — 1-3 sentences maximum for status queries.
- Use natural spoken language, not bullet points or markdown.
- Acknowledge quickly, then take action. "On it." or "Let me check." before calling tools.
- Numbers: say "eight hundred and forty-seven thousand" not "$847,000" for audio output.
  Exception: percentages ("thirty percent"), pipeline stage names ("Demo Booked").
- If you don't know something, say so briefly. Don't invent data.
- Use the user's first name if provided in context.

## Action rules

1. SPOKEN GOALS: When the user says "queue a follow-up call for Priya" or "send Sarah
   a follow-up email" — call submit_spoken_goal. Confirm with "Done, I've queued that."
2. STATUS QUERIES: "How did the Meridian call go?" → call spoken_call_result.
   "What's in my pipeline?" → call spoken_pipeline_status.
3. APPROVALS: "What needs my approval?" → call spoken_pending_approvals.
   For low-risk approvals: "Approve the first one" → call spoken_approve_item with confirmation.
   For HIGH-RISK approvals: "That one needs your Control Panel — I can't approve it by voice."
4. MORNING BRIEFING: "Good morning", "Brief me", "What did the agents do overnight?"
   → call spoken_morning_briefing, then give a natural spoken 3-4 sentence summary.
5. When the user says goodbye or stop, call end_session.

## What you must NOT do

- Do NOT invent pipeline numbers, call outcomes, or deal values.
- Do NOT approve mandatory or high-risk items by voice.
- Do NOT perform actions the user has not explicitly requested.
- Do NOT give long responses — this is voice, not text.
""".strip()

TEXT_SYSTEM_PROMPT = SYSTEM_PROMPT.replace("submit_spoken_goal", "submit_goal").replace(
    "spoken_call_result", "query_call_result"
).replace("spoken_pipeline_status", "query_pipeline_status").replace(
    "spoken_pending_approvals", "list_pending_approvals"
).replace("spoken_approve_item", "approve_item").replace(
    "spoken_morning_briefing", "get_morning_briefing"
)

MODEL = os.environ.get("AMBIENT_MODEL", "amazon.nova-2-sonic-v1:0")
VOICE_REGION = os.environ.get("AMBIENT_VOICE_REGION", "us-east-1")
TEXT_FALLBACK_MODEL = os.environ.get("AMBIENT_TEXT_MODEL", "global.amazon.nova-2-lite-v1:0")

HTTP_TOOLS = [
    submit_goal,
    query_pipeline_status,
    query_call_result,
    list_pending_approvals,
    approve_item,
    get_morning_briefing,
]


def _spoken(result: object) -> str:
    """Turn a Strands AgentResult into a short string the voice panel can show."""
    msg = getattr(result, "message", None)
    if isinstance(msg, str) and msg.strip():
        return msg.strip()
    if isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, list):
            bits: list[str] = []
            for block in content:
                if isinstance(block, dict) and block.get("text"):
                    bits.append(str(block["text"]))
                elif isinstance(block, str):
                    bits.append(block)
            if bits:
                return " ".join(bits).strip()
    return str(result).strip()


def _sonic_model() -> SonicModel:
    """Nova 2 Sonic: 16 kHz in, 24 kHz out (AWS default output). Keys differ by Strands class."""
    try:
        return SonicModel(
            model_id=MODEL,
            region=VOICE_REGION,
            voice="matthew",
            audio={"input": {"sample_rate": 16000}, "output": {"sample_rate": 24000}},
        )
    except TypeError:
        return SonicModel(
            model_id=MODEL,
            client_config={"region": VOICE_REGION},
            provider_config={
                "audio": {
                    "input_rate": 16000,
                    "output_rate": 24000,
                    "channels": 1,
                    "format": "pcm",
                    "voice": "matthew",
                }
            },
        )


def make_bidi_agent(tenant_id: str, user_id: str) -> BidiAgent:
    """One BidiAgent per WebSocket — tools are bound to the signed workspace."""
    return BidiAgent(
        model=_sonic_model(),
        system_prompt=(
            SYSTEM_PROMPT
            + f"\n\nUser context: tenant={tenant_id}, userId={user_id}."
        ),
        tools=session_tools(tenant_id),
    )


def run(event: dict) -> dict:
    """HTTP /invocations entry — typed fallback when the browser sends text only."""
    tenant_id = event.get("tenantId", "")
    user_id = event.get("userId", "")
    message = event.get("message", "")
    session = event.get("sessionId", "")

    if not message:
        return {"ok": False, "error": "message is required"}

    agent = Agent(
        model=build_model(TEXT_FALLBACK_MODEL),
        system_prompt=(
            TEXT_SYSTEM_PROMPT
            + f"\n\nUser context: tenant={tenant_id}, userId={user_id}, session={session}"
        ),
        tools=HTTP_TOOLS,
    )

    result = agent(message)
    return {
        "ok": True,
        "response": _spoken(result),
        "sessionId": session,
        "tenantId": tenant_id,
        "inputModality": "voice",
    }
