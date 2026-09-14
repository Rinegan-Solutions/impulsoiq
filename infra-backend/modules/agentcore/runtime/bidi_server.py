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
    headers = {k.lower(): v for k, v in websocket.headers.items()}
    tenant_id = _header(headers, "tenantid")
    user_id = _header(headers, "userid")
    if not tenant_id:
        await websocket.close(code=1008, reason="missing workspace")
        return

    await websocket.accept()
    bidi = _agent.make_bidi_agent(tenant_id, user_id)
    log.info("bidi session start tenant=%s user=%s", tenant_id, user_id)
    try:
        await bidi.run(inputs=[websocket.receive_json], outputs=[websocket.send_json])
    except WebSocketDisconnect:
        log.info("bidi client disconnected tenant=%s", tenant_id)
    except Exception as exc:
        if type(exc).__name__ == "ExceptionGroup" or isinstance(exc, BaseExceptionGroup):
            log.info("bidi session ended tenant=%s err=%s", tenant_id, exc)
        else:
            log.error("bidi session failed\n%s", traceback.format_exc())
    finally:
        try:
            await bidi.stop()
        except Exception:
            log.warning("bidi stop failed\n%s", traceback.format_exc())


if __name__ == "__main__":
    log.info("serving %s bidi on :%d", AGENT_MODULE, PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
