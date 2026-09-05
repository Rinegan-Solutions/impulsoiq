"""
Ambient Interface Agent — Phase 4A.

Lets the professional TALK TO ImpulsoIQ using Amazon Nova 2 Sonic.
This is DISTINCT from the Voice Agent (Phase 2) which calls OTHER PEOPLE.

- Input modality: voice (streamed audio via WebSocket → voice-bridge Lambda)
- Model: amazon.nova-sonic-v1:0 (bidirectional streaming, real-time conversation)
- Tools: same Gateway tool surface as typed goals — submit_goal, query_pipeline_status,
         query_call_result, list_pending_approvals, approve_item, get_morning_briefing

Every action taken via voice is logged identically to typed actions with
input_modality='voice', so the full audit trail is maintained.

ARM64 container; invoked by the voice-bridge Lambda via AgentCore Runtime API.
"""
import json
import os
from strands import Agent
from impulsoiq_model import build_model
from .tools import (
    submit_goal,
    query_pipeline_status,
    query_call_result,
    list_pending_approvals,
    approve_item,
    get_morning_briefing,
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
   a follow-up email" — call submit_goal. Confirm with "Done, I've queued that."
2. STATUS QUERIES: "How did the Meridian call go?" → call query_call_result.
   "What's in my pipeline?" → call query_pipeline_status.
3. APPROVALS: "What needs my approval?" → call list_pending_approvals.
   For low-risk approvals: "Approve the first one" → call approve_item with confirmation.
   For HIGH-RISK approvals: "That one needs your Control Panel — I can't approve it by voice."
4. MORNING BRIEFING: "Good morning", "Brief me", "What did the agents do overnight?"
   → call get_morning_briefing, then give a natural spoken 3-4 sentence summary.

## What you must NOT do

- Do NOT invent pipeline numbers, call outcomes, or deal values.
- Do NOT approve mandatory or high-risk items by voice.
- Do NOT perform actions the user has not explicitly requested.
- Do NOT give long responses — this is voice, not text.
""".strip()

# Nova 2 Sonic is the voice model; fall back to Sonnet for text-only mode
# Nova Sonic is not offered in ANY EU region -- eu-west-2 and eu-west-1 both
# return no sonic model. Speech-to-speech therefore runs cross-region, and
# AMBIENT_VOICE_REGION says where. The text path stays in-region on Nova 2
# Lite, so losing the voice endpoint degrades the agent rather than breaking it.
MODEL = os.environ.get("AMBIENT_MODEL", "amazon.nova-2-sonic-v1:0")
VOICE_REGION = os.environ.get("AMBIENT_VOICE_REGION", "us-east-1")
TEXT_FALLBACK_MODEL = os.environ.get("AMBIENT_TEXT_MODEL", "global.amazon.nova-2-lite-v1:0")


def run(event: dict) -> dict:
    """
    Entry point invoked by the voice-bridge Lambda.

    Two invocation modes:
    1. TEXT MODE (testing/fallback): event contains { tenantId, userId, message, sessionId }
    2. AUDIO MODE (production): the voice-bridge Lambda handles audio streaming;
       this agent receives transcribed text and returns text for TTS.

    For the hackathon demo, TEXT MODE is used so the agent can be tested
    without a live microphone session.
    """
    tenant_id = event.get("tenantId", "")
    user_id   = event.get("userId", "")
    message   = event.get("message", "")
    session   = event.get("sessionId", "")

    if not message:
        return {"ok": False, "error": "message is required"}

    # Use text fallback model if audio model unavailable
    # Only the text path is a Strands Agent. Sonic is bidirectional
    # streaming and is driven directly by the voice bridge.
    model = (
        build_model(TEXT_FALLBACK_MODEL)
        if event.get("textMode")
        else build_model(MODEL, region=VOICE_REGION)
    )

    agent = Agent(
        model         = model,
        system_prompt = SYSTEM_PROMPT + f"\n\nUser context: tenant={tenant_id}, userId={user_id}, session={session}",
        tools         = [
            submit_goal,
            query_pipeline_status,
            query_call_result,
            list_pending_approvals,
            approve_item,
            get_morning_briefing,
        ],
    )

    result = agent(message)
    response_text = str(result)

    return {
        "ok":           True,
        "response":     response_text,
        "sessionId":    session,
        "tenantId":     tenant_id,
        "inputModality": "voice",
    }
