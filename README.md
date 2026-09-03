# ImpulsoIQ

Agentic business workspace — CRM + sales engagement + AI SDR platform powered by AWS Strands Agents SDK and Amazon Bedrock AgentCore.

## Structure

```
apps/web/          React PWA (CRM dashboard + Agent Control Panel)
apps/admin/        Ops admin — LATER
packages/api-types/ Shared TypeScript domain types
packages/domain/   Shared business logic
infra-web/         Terraform: S3, CloudFront, ACM, Route 53
infra-backend/     Terraform: Cognito, APIGW, Lambda, AppSync, Step Functions, AgentCore, data
  modules/lambda/codes/   Lambda handlers (TypeScript)
  modules/agentcore/codes/ Agent definitions (Python, Strands SDK, ARM64)
ci-cd/             CodePipeline templates
docs/              PRD and architecture docs
```

## Development

```bash
npm install                          # install all workspace deps
npm run dev:web                      # start web dev server (http://localhost:5173)
npm run typecheck                    # type-check all packages and apps
```

### Lambda functions

```bash
cd infra-backend/modules/lambda/codes/<function>
npm install && npm run build
```

### Python agents

```bash
cd infra-backend/modules/agentcore/codes/<agent>
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Terraform

```bash
cd infra-web        # or infra-backend
terraform init
cp terraform.tfvars.example terraform.tfvars  # fill in values
terraform plan -var-file=terraform.tfvars
```

## Hackathon deadlines

Both submissions due **September 14, 2026**.
- AWS *Agents for Humans* (Strands Agents SDK + Bedrock AgentCore)
- *CALL-E: Your Code Is Calling*
