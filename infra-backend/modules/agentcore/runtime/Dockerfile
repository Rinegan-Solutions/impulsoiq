# Shared image for every ImpulsoIQ agent.
#
# AgentCore Runtime requires linux/arm64 (aarch64) — see CLAUDE.md. The agent
# to serve is chosen at build time via AGENT_NAME, which selects the source
# directory and sets AGENT_MODULE for server.py.
#
# Build (from infra-backend/modules/agentcore):
#   docker build --platform linux/arm64 \
#     -f runtime/Dockerfile \
#     --build-arg AGENT_NAME=coordinator \
#     -t <ecr-url>:latest .

FROM --platform=linux/arm64 public.ecr.aws/docker/library/python:3.12-slim

ARG AGENT_NAME
ENV AGENT_MODULE=${AGENT_NAME} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

# Install agent dependencies first so layer caching survives source edits.
COPY codes/${AGENT_NAME}/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# The agent package, imported by server.py as "<AGENT_NAME>.agent"
COPY codes/${AGENT_NAME}/ ./${AGENT_NAME}/
COPY runtime/server.py ./server.py
# Shared model construction (Nova 2 Lite + extended thinking). Copied into every
# agent image so the reasoning configuration lives in one file, not fourteen.
COPY runtime/impulsoiq_model.py ./impulsoiq_model.py

# Namespace packages work without __init__.py on Python 3.3+, but an explicit
# one keeps relative imports (`from .tools import ...`) unambiguous.
RUN touch ./${AGENT_NAME}/__init__.py

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/ping', timeout=2).status==200 else 1)"

CMD ["python", "server.py"]
