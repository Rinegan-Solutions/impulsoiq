# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Web app (apps/web)
```bash
npm install                          # install all workspace deps (root)
npm run dev:web                      # Vite dev server → http://localhost:5173
npm run build:web                    # type-check + Vite build
npm run typecheck                    # type-check all packages and apps
# Landing page: open apps/web/landing.html in browser (static, no build needed)
# In dev: http://localhost:5173/landing.html
```

### Lambda functions (Node/TS, built with esbuild)
```bash
cd infra-backend/modules/lambda/codes/<function>
npm install
npm run build          # produces dist.zip ready for Terraform
npm run typecheck
```

### Python agents (Strands SDK, ARM64)
```bash
cd infra-backend/modules/agentcore/codes/<agent>
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
python -c "from agent import run; print(run({}))"       # smoke test
```

### Apply DSQL schema (one-time per environment)
```bash
# Requires DSQL endpoint and a valid IAM session
psql "host=<dsql-endpoint> dbname=postgres user=admin sslmode=require" \
  -f infra-backend/modules/data/schema.sql
```

### Seed the agent registry (Phase 6B — run once after schema apply)
```bash
aws lambda invoke \
  --function-name impulsoiq-registry-seeder-dev \
  --invocation-type RequestResponse \
  /dev/stdout
```

### AWS provider version (current: 6.62.0 — constraint ~> 6.18 covers this)
```bash
# Check latest version via Terraform registry
# hashicorp/aws latest: 6.62.0  (verified 2026-09-02)
```

### Terraform
```bash
cd infra-web                          # or infra-backend
terraform init
cp terraform.tfvars.example terraform.tfvars  # fill in values
terraform plan  -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

### CI/CD (CloudFormation) — two stacks total
Each template defines BOTH pipelines: `NonProdPipeline` (develop → dev → test)
and `ProdPipeline` (main → prod, double-gated), sharing one artifact bucket and
one CodePipeline role.

```bash
# Backend pipelines (dev + test + prod)
aws cloudformation deploy \
  --template-file ci-cd/infra-backend-pipeline.yaml \
  --stack-name impulsoiq-backend-pipeline \
  --parameter-overrides GitHubOwner=<owner> GitHubRepo=impulsoiq \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region eu-west-2

# Web pipelines (dev + test + prod)
aws cloudformation deploy \
  --template-file ci-cd/infra-web-pipeline.yaml \
  --stack-name impulsoiq-web-pipeline \
  --parameter-overrides GitHubOwner=<owner> GitHubRepo=impulsoiq \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region eu-west-2
```

Branch → environment mapping is carried by the `ENV` variable on each CodeBuild
project (dev|test|prod), which selects `environments/${ENV}/backend.hcl` and
`environments/${ENV}/terraform.tfvars`. Each environment has its own scoped
CodeBuild IAM role — no `AdministratorAccess` anywhere.

### Environments folder — Terraform per-env config
```
infra-backend/environments/{dev,test,prod}/
  backend.hcl      — bucket/key/region + use_lockfile (used with -backend-config)
  terraform.tfvars — env, aws_region (used with -var-file)

infra-web/environments/{dev,test,prod}/
  backend.hcl
  terraform.tfvars
```

Local Terraform workflow (any environment):
```bash
cd infra-backend
terraform init -backend-config="environments/dev/backend.hcl"
terraform plan  -var-file="environments/dev/terraform.tfvars"
terraform apply -var-file="environments/dev/terraform.tfvars"
```

---

## Project Overview

ImpulsoIQ is an agentic business workspace — CRM + sales engagement + AI SDR platform where autonomous AI agents perform outreach, contact enrichment, sequencing, and voice calls on behalf of revenue teams. The primary deliverable is a hackathon MVP due **September 14, 2026** targeting two AWS hackathons: *Agents for Humans* (Strands Agents SDK + Bedrock AgentCore) and *CALL-E: Your Code Is Calling*.

Interim domain: `{subdomain}.impulsoiq.rinegansolutions.com`

Design documents are in [docs/](docs/):
- [impulsoiq-prd-v3.md](docs/impulsoiq-prd-v3.md) — product requirements
- [impulsoiq-technical-architecture-v1.md](docs/impulsoiq-technical-architecture-v1.md) — full technical architecture

---

## Tech Stack

### Agent / AI Layer
- **AWS Strands Agents SDK** (Python) — agent authoring
- **Amazon Bedrock AgentCore** — Runtime (per-session microVMs), Memory, Gateway (MCP endpoint for tools), Identity, Observability
- **Amazon Bedrock** — Claude and/or Nova foundation models
- **CALL-E** — voice calls, wrapped behind a `VoiceProvider` interface (submitted as Agent Skill or Workflow Plugin)

### Frontend
- **React SPA** (TypeScript) — role-based dashboards, Agent Control Panel with real-time push
- Hosted on **S3 + CloudFront**

### Backend
- **AWS Lambda** — CRUD, auth, webhooks, campaign triggers
- **Amazon API Gateway** — REST + WebSocket (auth via Lambda authorizer)
- **AWS AppSync** — GraphQL subscriptions for real-time Agent Control Panel; use **JS resolvers** (APPSYNC_JS runtime); VTL only as a last resort
- **AWS Step Functions** — durable campaign workflow orchestration (pause/resume on async voice call completion)
- **Amazon EventBridge** — event routing; resumes Step Functions graph on CALL-E `CallCompleted` webhook

### Databases
- **Aurora DSQL** (PostgreSQL-compatible) — system-of-record relational data. Supported: FK constraints, JSONB, identity columns/sequences. **Not supported:** triggers, stored procedures, advisory locks, `SERIALIZABLE` isolation, extensions (no pgvector). Bulk writes must be chunked (~10,000 rows max per transaction). **All CRM writes go through one CRM Write Service** — specialist agents never write directly to avoid OCC retry storms.
- **Amazon DynamoDB** — single-table design for append-only event/audit log, session state, idempotency, metering. Partition key: `tenant_id#entity_type#entity_id`, sort key: `timestamp#event_type`. DynamoDB Streams enabled with three independent consumers.
- **Amazon S3 Vectors** — semantic/embedding memory (call transcripts, email bodies, notes); Bedrock Titan embeddings written via Lambda triggered from DynamoDB Streams.

### Auth & Multi-tenancy
- **Amazon Cognito** — authentication, SSO/SAML for enterprise tier, RBAC
- 3-layer tenant isolation: CloudFront Function (subdomain → `tenant_id`) → JWT `tenant_id` claim validation in Lambda authorizer → parameterized `tenant_id` in every DB query

### IaC / CI/CD
- **Terraform** (`hashicorp/aws` v6.18+) — all infra including `aws_bedrockagentcore_*` resources
- **AWS CodePipeline** — plan → approve → apply per environment
- AgentCore Runtime containers must target **ARM64** (`ARM_CONTAINER`/`aarch64`)
- Module layout: `agentcore/`, `data/`, `networking/`, `api/`, `frontend/`

---

## Core Architecture Decisions

| Decision | Choice |
|---|---|
| Agent topology | Graph (deterministic, auditable); Swarm deferred |
| Voice calls | Async — `run_call` fires, graph pauses in Step Functions, resumes on CALL-E webhook → EventBridge |
| CRM writes | Single CRM Write Service only; specialist agents never write directly |
| Event/audit store | DynamoDB (not DSQL) |
| Real-time UI | AppSync + JS resolvers (polling acceptable for hackathon demo if AppSync risks timeline) |
| Metering | Separate pipeline; checked pre-action (synchronous tier enforcement) |
| Memory | One Gateway tool → AgentCore Memory + S3 Vectors |
| Consent | `ConsentRecord` is a first-class entity — hard gate checked in every tool call before outbound email/SMS/call |
| CALL-E integration | Wrapped behind `VoiceProvider` interface |

---

## Core Data Model (Aurora DSQL)

Tables: `tenant`, `account`, `contact`, `deal`, `activity`, `call_result`, `agent_run`, `campaign`, `consent_record`

- `activity.type` ENUM: `email | sms | call | note | task | meeting`
- `activity.actor_type` ENUM: `human | agent`
- `ConsentRecord` — not a flag on Contact; a separate entity checked as a hard gate before every outbound action

---

## MVP Scope (Hackathon)

Single campaign type: SDR/AE lead-qualification + follow-up

Agents in scope:
- Coordinator
- Research/Enrichment (single data source)
- Outreach (email; SMS optional)
- Voice (CALL-E via MCP — qualification + meeting-confirmation calls)

Deferred for post-MVP: S3 Vectors embed pipeline, metering pipeline, OpenSearch, multi-persona demo, enterprise SSO, i18n, QuickSight analytics.

Hackathon deliverables: public MIT/Apache repo + README + setup instructions, architecture diagram, ≤5-min demo video (AWS) / ~3-min demo video (CALL-E), live demo link.
