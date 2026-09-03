"""
AgentCore Runtime HTTP contract wrapper.

Every ImpulsoIQ agent exposes a single entry point:

    def run(event: dict) -> dict

Bedrock AgentCore Runtime, however, invokes a container over HTTP. This module
is the thin adapter between the two: it imports the agent package named by the
AGENT_MODULE environment variable and serves its run() function on the two
endpoints AgentCore requires.

    POST /invocations  → run(request_body) → JSON response
    GET  /ping         → readiness probe

Kept deliberately dependency-free (stdlib http.server) so the image stays small
and the wrapper itself cannot fail for reasons unrelated to the agent.
"""
import importlib
import json
import logging
import os
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("agentcore.server")

AGENT_MODULE = os.environ.get("AGENT_MODULE")
if not AGENT_MODULE:
    raise RuntimeError("AGENT_MODULE environment variable is required")

PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY_BYTES = 5 * 1024 * 1024  # 5 MB ceiling on a single invocation payload

# Import once at start-up so a broken agent fails the container health check
# immediately rather than on first invocation.
_agent = importlib.import_module(f"{AGENT_MODULE}.agent")
if not hasattr(_agent, "run"):
    raise RuntimeError(f"{AGENT_MODULE}.agent does not define run(event)")
log.info("loaded agent module %s", AGENT_MODULE)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path.rstrip("/") == "/ping":
            self._respond(200, {"status": "healthy", "agent": AGENT_MODULE})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path.rstrip("/") != "/invocations":
            self._respond(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            self._respond(413, {"error": "payload too large"})
            return

        try:
            raw = self.rfile.read(length) if length else b"{}"
            event = json.loads(raw or b"{}")
        except json.JSONDecodeError as exc:
            self._respond(400, {"error": f"invalid JSON body: {exc}"})
            return

        try:
            result = _agent.run(event)
            self._respond(200, result if isinstance(result, dict) else {"result": result})
        except Exception as exc:  # noqa: BLE001 - surface any agent failure as 500
            log.error("agent %s failed: %s\n%s", AGENT_MODULE, exc, traceback.format_exc())
            self._respond(500, {"error": str(exc), "agent": AGENT_MODULE})

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s - %s", self.address_string(), fmt % args)


if __name__ == "__main__":
    log.info("serving %s on :%d", AGENT_MODULE, PORT)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
