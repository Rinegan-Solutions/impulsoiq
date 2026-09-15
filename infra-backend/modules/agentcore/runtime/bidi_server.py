"""
Ambient-interface HTTP + WebSocket contract for AgentCore Runtime.

    GET  /ping         readiness
    POST /invocations  typed Strands Agent (voice-bridge text fallback)
    GET  /ws           BidiAgent + Nova Sonic (browser PCM in/out)

AgentCore HTTP protocol still hosts /ws on port 8080 of the same container.
"""
from __future__ import annotations

import importlib
import json
import logging
import os
import traceback

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("agentcore.bidi")

AGENT_MODULE = os.environ.get("AGENT_MODULE")
if not AGENT_MODULE:
    raise RuntimeError("AGENT_MODULE environment variable is required")

PORT = int(os.environ.get("PORT", "8080"))

_agent = importlib.import_module(f"{AGENT_MODULE}.agent")
if not hasattr(_agent, "run") or not hasattr(_agent, "make_bidi_agent"):
    raise RuntimeError(f"{AGENT_MODULE}.agent must define run(event) and make_bidi_agent")
log.info("loaded bidi agent module %s", AGENT_MODULE)

app = FastAPI()


def _header(headers: dict[str, str], suffix: str) -> str:
    key = f"x-amzn-bedrock-agentcore-runtime-custom-{suffix}"
    return (headers.get(key) or "").strip()


def _session_identity(headers: dict[str, str], query: dict[str, str]) -> tuple[str, str]:
    """
    Tenant/user from custom headers (allowlisted), the same names as query
    params (browser presign), or the Session-Id we minted as tenant__user__session.
    Custom headers are stripped when the runtime allowlist is not applied.
    Session-Id is a first-class AgentCore header and always reaches /ws.
    """
    tenant = (
        _header(headers, "tenantid")
        or query.get("x-amzn-bedrock-agentcore-runtime-custom-tenantid")
        or ""
    )
    user = (
        _header(headers, "userid")
        or query.get("x-amzn-bedrock-agentcore-runtime-custom-userid")
        or ""
    )
    session = (
        headers.get("x-amzn-bedrock-agentcore-runtime-session-id")
        or query.get("x-amzn-bedrock-agentcore-runtime-session-id")
        or ""
    )
    if (not tenant or not user) and "__" in session:
        parts = session.split("__")
        if len(parts) >= 3:
            tenant = tenant or parts[0]
            user = user or parts[1]
    return tenant, user


def _event_payload(event: object) -> dict:
    if isinstance(event, dict):
        payload: object = event
    else:
        payload = None
        for attr in ("to_dict", "as_dict", "model_dump"):
            fn = getattr(event, attr, None)
            if callable(fn):
                payload = fn()
                break
        if not isinstance(payload, dict):
            data = getattr(event, "__dict__", None)
            payload = (
                {k: v for k, v in data.items() if not str(k).startswith("_")}
                if isinstance(data, dict)
                else {"type": getattr(event, "type", "bidi_unknown"), "text": str(event)}
            )
    return json.loads(json.dumps(payload, default=str))


async def _receive_json(websocket: WebSocket):
    message = await websocket.receive()
    if message.get("type") == "websocket.disconnect":
        raise WebSocketDisconnect(code=int(message.get("code") or 1000))
    raw = message.get("text")
    if raw is None and message.get("bytes") is not None:
        raw = bytes(message["bytes"]).decode("utf-8")
    if not raw:
        raise WebSocketDisconnect(code=1003)
    return json.loads(raw)


async def _receive_event(websocket: WebSocket):
    """JSON dicts → Bidi*InputEvent, matching the Strands WebSocket sample."""
    data = await _receive_json(websocket)
    if not isinstance(data, dict) or "type" not in data:
        return data
    event_type = data["type"]
    event_data = {k: v for k, v in data.items() if k != "type"}
    try:
        from strands.experimental.bidi.types.events import (
            BidiAudioInputEvent,
            BidiImageInputEvent,
            BidiTextInputEvent,
        )
    except ImportError:
        return data
    try:
        if event_type == "bidi_audio_input":
            return BidiAudioInputEvent(**event_data)
        if event_type == "bidi_text_input":
            return BidiTextInputEvent(**event_data)
        if event_type == "bidi_image_input":
            return BidiImageInputEvent(**event_data)
    except (TypeError, ValueError):
        return data
    return data


@app.get("/ping")
def ping() -> dict[str, str]:
    return {"status": "healthy", "agent": AGENT_MODULE}


@app.post("/invocations")
async def invocations(request: Request) -> JSONResponse:
    try:
        event = await request.json()
        if not isinstance(event, dict):
            event = {}
    except json.JSONDecodeError as exc:
        return JSONResponse({"error": f"invalid JSON body: {exc}"}, status_code=400)
    try:
        result = _agent.run(event)
        payload = result if isinstance(result, dict) else {"result": result}
        return JSONResponse(payload)
    except Exception as exc:  # noqa: BLE001
        log.error("agent %s failed: %s\n%s", AGENT_MODULE, exc, traceback.format_exc())
        return JSONResponse({"error": str(exc), "agent": AGENT_MODULE}, status_code=500)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    # Accept before reading identity. Closing without accept fails the AgentCore
    # client handshake and the browser only sees "Live voice dropped".
    await websocket.accept()
    headers = {k.lower(): v for k, v in websocket.headers.items()}
    query = {k.lower(): v for k, v in websocket.query_params.items()}
    tenant_id, user_id = _session_identity(headers, query)
    if not tenant_id:
        log.warning("bidi session missing workspace headers=%s query=%s", list(headers), list(query))
        await websocket.send_json({
            "type": "bidi_error",
            "code": "missing_workspace",
            "message": "Live voice could not bind to a workspace. Type instead.",
        })
        await websocket.close(code=1008)
        return

    try:
        bidi = _agent.make_bidi_agent(tenant_id, user_id)
    except Exception:
        log.error("bidi agent init failed\n%s", traceback.format_exc())
        await websocket.send_json({
            "type": "bidi_error",
            "code": "agent_init",
            "message": "Live voice could not start. You can still type.",
        })
        await websocket.close(code=1011)
        return

    log.info("bidi session start tenant=%s user=%s", tenant_id, user_id)
    try:
        # Official contract: receive_json / send_json of bidi_* events.
        # https://strandsagents.com/docs/user-guide/concepts/bidirectional-streaming/io/
        await bidi.run(
            inputs=[lambda: _receive_event(websocket)],
            outputs=[lambda event: websocket.send_json(_event_payload(event))],
        )
    except WebSocketDisconnect:
        log.info("bidi client disconnected tenant=%s", tenant_id)
    except Exception as exc:
        if type(exc).__name__ == "ExceptionGroup" or isinstance(exc, BaseExceptionGroup):
            log.info("bidi session ended tenant=%s err=%s", tenant_id, exc)
        else:
            log.error("bidi session failed\n%s", traceback.format_exc())
            try:
                await websocket.send_json({
                    "type": "bidi_error",
                    "code": "session_failed",
                    "message": "Live voice dropped. You can still type.",
                })
            except Exception:
                pass
    finally:
        try:
            await bidi.stop()
        except Exception:
            log.warning("bidi stop failed\n%s", traceback.format_exc())


if __name__ == "__main__":
    log.info("serving %s bidi on :%d", AGENT_MODULE, PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
