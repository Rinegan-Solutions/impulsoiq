# ─── AgentCore — Phase 1 ────────────────────────────────────────────────────
# Provider: hashicorp/aws v6.18+
# All AgentCore Runtime containers target ARM64 (aarch64).

locals {
  # ── Bedrock model selection ────────────────────────────────────────────────
  # Every agent read a *_MODEL env var and fell back to a hardcoded
  # "us.amazon.nova-lite-v1:0". The us. prefix is a US-ONLY cross-region
  # inference profile: it does not resolve in eu-west-2, so every agent failed
  # on its first model call. eu-west-2 publishes exactly one Nova inference
  # profile, and it is the Nova 2 Lite that both plans specify as the roster
  # default:
  #
  #   $ aws bedrock list-inference-profiles --region eu-west-2
  #     global.amazon.nova-2-lite-v1:0
  #
  # Setting these here rather than editing each agent keeps the model a
  # deployment decision, so a region change or a model upgrade is one edit.
  default_model = "global.amazon.nova-2-lite-v1:0"

  # ONE model across the whole roster, by product decision. Plan v3 §5.2 split
  # Signal Listening's first-pass filter onto Nova Micro for cost; that split is
  # dropped. The cost controls that matter for that agent are unchanged and are
  # enforced in its own code: a hard daily token budget and a 2K-character input
  # cap per candidate, neither of which depends on the model tier.
  classifier_model = local.default_model

  # Per-agent environment overrides, keyed by the variable each agent reads.
  agent_model_env = {
    coordinator         = { COORDINATOR_MODEL = local.default_model }
    clarification       = { CLARIFICATION_MODEL = local.default_model }
    research-enrichment = { ENRICHMENT_MODEL = local.default_model }
    outreach            = { OUTREACH_MODEL = local.default_model }
    voice               = { VOICE_MODEL = local.default_model }
    nurture             = { NURTURE_MODEL = local.default_model }
    forecasting-insight = { FORECASTING_MODEL = local.default_model }
    data-hygiene        = { HYGIENE_MODEL = local.default_model }
    deep-research       = { DEEP_RESEARCH_MODEL = local.default_model }
    triage-escalation   = { TRIAGE_MODEL = local.default_model }
    resolution          = { RESOLUTION_MODEL = local.default_model }
    support-insight     = { SUPPORT_INSIGHT_MODEL = local.default_model }

    signal-listening = {
      SIGNAL_STAGE2_MODEL     = local.default_model
      SIGNAL_CLASSIFIER_MODEL = local.classifier_model
    }

    # Nova Sonic is not available in ANY EU region. Verified against the account:
    #   eu-west-2, eu-west-1, eu-central-1  -> no sonic model
    #   us-east-1                           -> nova-2-sonic-v1:0, nova-sonic-v1:0
    #   us-west-2, ap-northeast-1           -> nova-2-sonic-v1:0
    # So the speech path runs cross-region and the region is named explicitly
    # rather than inherited, because sending EU customers' voice audio to a US
    # region is a data-residency decision (PRD §12, GDPR) and not one to make by
    # accident. The text path stays in-region on Nova 2 Lite, so an unreachable
    # voice endpoint degrades the agent instead of breaking it.
    ambient-interface = {
      AMBIENT_MODEL        = var.ambient_voice_model
      AMBIENT_VOICE_REGION = var.ambient_voice_region
      AMBIENT_TEXT_MODEL   = local.default_model
    }
  }

  # NOTE: AgentCore naming rules differ per resource, in opposite directions.
  #   agent_runtime_name    [a-zA-Z0-9_], max 48  — underscores, NO hyphens
  #   gateway_target.name   ^([0-9a-zA-Z][-]?)+$  — hyphens, NO underscores
  # The agent keys below keep hyphens because they also name ECR repositories
  # and source directories. agent_runtime_name converts them with replace();
  # everything else uses them as-is. Longest runtime name is
  # impulsoiq_research_enrichment_prod (34 chars), inside the 48 limit.
  agents = {
    coordinator         = { description = "Plans, decomposes, orchestrates all other agents" }
    clarification       = { description = "Turns ambiguous goals into fully-specified ones" }
    research-enrichment = { description = "Enriches contacts with firmographic data and computes ICP fit score" }
    outreach            = { description = "Drafts and sends personalised, compliant email and SMS messages" }
    voice               = { description = "Initiates async CALL-E voice calls and processes call results" }
    nurture             = { description = "Manages post-first-touch nurture cadence using engagement signals" }
    # Phase 3 agents
    forecasting-insight = { description = "Computes pipeline forecasts and surfaces risk flags on a daily schedule" }
    data-hygiene        = { description = "Detects duplicates and decayed records; proposes fixes for human approval" }
    # Phase 4 agents
    ambient-interface = { description = "Nova Sonic voice interface — lets the professional talk to ImpulsoIQ" }
    deep-research     = { description = "Swarm topology: parallel multi-strategy company research" }
    signal-listening  = { description = "Continuous public-signal monitoring to originate new candidate leads (v3)" }
    # Phase 7 agents
    triage-escalation = { description = "Classifies every inbound support contact into tier 0-3 for routing (v4)" }
    # Phase 8 agents
    resolution = { description = "KB-grounded auto-resolve and draft-for-review; confidence gate overrides Triage (v4)" }
    # Phase 9 agents
    support-insight = { description = "Computes support health metrics and KB gaps; feeds support signals back to renewal-risk scoring (v4)" }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ── KMS — encrypts AgentCore Memory ──────────────────────────────────────────
resource "aws_kms_key" "agentcore" {
  description             = "${var.project} AgentCore memory (${var.env})"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_kms_alias" "agentcore" {
  name          = "alias/${var.project}-agentcore-${var.env}"
  target_key_id = aws_kms_key.agentcore.key_id
}

# ── IAM role used by all AgentCore Runtime containers ────────────────────────
resource "aws_iam_role" "agentcore_runtime" {
  name = "${var.project}-agentcore-runtime-${var.env}"

  # The principal is bedrock-agentcore.amazonaws.com, NOT bedrock.amazonaws.com.
  # AgentCore is a separate service from Bedrock model inference and assumes
  # this role under its own principal. With the wrong one, CreateGateway fails
  # with "Gateway service is not authorized to perform AssumeRole on Gateway
  # role" -- an authorization error that reads like a missing permission but is
  # really a trust-policy mismatch.
  #
  # The condition is aws:SourceAccount only. AWS also suggests pinning
  # aws:SourceArn to the gateway, but that ARN does not exist until the gateway
  # is created with this role -- a cycle. SourceAccount still closes the
  # cross-account confused-deputy hole, which is what the condition is for.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.current.account_id
        }
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "agentcore_runtime" {
  name = "agentcore-runtime-policy"
  role = aws_iam_role.agentcore_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream",
        "bedrock:Converse", "bedrock:ConverseStream"]
        Resource = "*"
      },
      {
        Sid      = "InvokeCrmWriteService"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.crm_write_service_arn
      },
      {
        Sid      = "StepFunctions"
        Effect   = "Allow"
        Action   = ["states:StartExecution", "states:DescribeExecution", "states:SendTaskSuccess"]
        Resource = "*"
      },
      {
        Sid      = "SSMRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/impulsoiq/${var.env}/*"
      },
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "*"
      },
      {
        Sid    = "KmsUse"
        Effect = "Allow"
        # AgentCore assumes this role under its own session names (e.g.
        # GenesisMCPTargetTargetEncryption) to encrypt gateway state, so the
        # full envelope-encryption set is needed, not just Decrypt.
        Action = [
          "kms:Decrypt", "kms:GenerateDataKey", "kms:Encrypt",
          "kms:DescribeKey", "kms:ReEncryptFrom", "kms:ReEncryptTo",
          "kms:CreateGrant",
        ]
        Resource = aws_kms_key.agentcore.arn
      },
      {
        # AgentCore Runtime pulls each agent's container image itself, using
        # THIS role. Without these, CreateAgentRuntime fails validation up front
        # with "Access denied while validating ECR URI" -- the image exists and
        # the URI is correct; the runtime simply cannot read it.
        Sid    = "EcrPullAgentImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability", "ecr:DescribeImages",
          "ecr:DescribeRepositories",
        ]
        Resource = [for r in data.aws_ecr_repository.agent : r.arn]
      },
      {
        # ecr:GetAuthorizationToken is account-level and admits no resource
        # scope -- it returns a token, not repository data.
        Sid      = "EcrAuthToken"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      }
    ]
  })
}

# ── ECR repositories (one per agent — ARM64 images) ──────────────────────────
#
# Read, not created. The repositories are owned by buildspec-agents.yml, which
# runs as the first action of every deploy stage: it creates any missing
# repository, then builds and pushes that agent's ARM64 image.
#
# Terraform cannot own them because of a chicken-and-egg: an
# aws_bedrockagentcore_agent_runtime is rejected if its container image does not
# already exist, so the image must be pushed before apply — which means the
# repository must exist before apply too. Having Terraform also declare them
# would collide with the buildspec on the very first run.
#
# Consequence worth knowing: `terraform destroy` leaves these repositories (and
# their images) behind. That is deliberate — tearing down an environment should
# not silently discard built images.
data "aws_ecr_repository" "agent" {
  for_each = local.agents
  name     = "${var.project}-agent-${each.key}-${var.env}"
}

# ── AgentCore Memory ──────────────────────────────────────────────────────────
# Long-term agent memory. event_expiry_duration is required by the provider.
# 90 days matches the reporting-store TTL so memory and reports age out together.
resource "aws_bedrockagentcore_memory" "main" {
  name                  = "${var.project}_memory_${var.env}"
  description           = "Long-term agent memory — tenant preferences, enrichment context"
  event_expiry_duration = 90
  tags                  = var.tags
}

# ── AgentCore Runtime (one per agent, ARM64) ──────────────────────────────────
resource "aws_bedrockagentcore_agent_runtime" "agent" {
  for_each = local.agents

  # Both this and the gateway reference the role's ARN, which exists the moment
  # the ROLE does -- so Terraform sees no reason to wait for the inline policy.
  # AgentCore validates the role's permissions during Create, so without this
  # the create can race the policy write and fail on permissions that the
  # finished config does grant. That failure looks exactly like a missing
  # permission, which sends you hunting for a grant that is already there.
  depends_on = [aws_iam_role_policy.agentcore_runtime]

  agent_runtime_name = replace("${var.project}_${each.key}_${var.env}", "-", "_")
  description        = each.value.description
  role_arn           = aws_iam_role.agentcore_runtime.arn

  agent_runtime_artifact {
    container_configuration {
      # ARM64 image — CodeBuild ARM_CONTAINER builds it from codes/<agent>/
      container_uri = "${data.aws_ecr_repository.agent[each.key].repository_url}:latest"
    }
  }

  network_configuration {
    network_mode = "PUBLIC" # Bedrock / APIGW / Cognito reachable without VPC
  }

  environment_variables = merge(
    local.agent_model_env[each.key],
    {
      # Extended thinking, on for every agent. Both plans make Nova 2 Lite at
      # MEDIUM reasoning effort the roster default; runtime/impulsoiq_model.py
      # reads this and sets reasoningConfig on every model call.
      BEDROCK_REASONING_EFFORT = var.reasoning_effort

      ENV                   = var.env
      CRM_WRITE_SERVICE_ARN = var.crm_write_service_arn
      CRM_READ_SERVICE_ARN  = var.crm_read_service_arn
      DYNAMODB_TABLE        = var.dynamodb_table
      EVENT_BUS_ARN         = var.agents_event_bus_arn
      AWS_REGION            = data.aws_region.current.region
      MEMORY_STORE_ID       = aws_bedrockagentcore_memory.main.id
    },
    each.key == "voice" ? {
      CALLE_BASE_URL    = var.calle_base_url
      CALLE_API_KEY_SSM = "/impulsoiq/${var.env}/calle/api_key"
      CALLE_WEBHOOK_URL = var.calle_webhook_url
    } : {},
    each.key == "outreach" ? {
      SES_CONFIGURATION_SET = "impulsoiq-${var.env}"
      SES_FROM_ADDRESS      = "noreply@impulsoiq.rinegansolutions.com"
      ENRICHMENT_API_URL    = var.enrichment_api_url
    } : {},
    each.key == "research-enrichment" ? {
      ENRICHMENT_API_URL = var.enrichment_api_url
      ENRICHMENT_API_KEY = var.enrichment_api_key
      # v3 step 4: email verification
      EMAIL_VERIFICATION_API_URL = var.email_verification_api_url
      EMAIL_VERIFICATION_API_KEY = var.email_verification_api_key
    } : {},
    contains(["forecasting-insight", "data-hygiene"], each.key) ? {
      REPORTING_TABLE = var.reporting_table
      METERING_TABLE  = var.metering_table
    } : {},
    each.key == "ambient-interface" ? {
      STATE_MACHINE_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/state_machine_arn"
    } : {},
    each.key == "deep-research" ? {
      REPORTING_TABLE = var.reporting_table
    } : {},
    each.key == "signal-listening" ? {
      # Stage 1 Nova Micro token budget (hard-coded cap, not agent-discretionary)
      SIGNAL_DAILY_STAGE1_TOKENS = "500000"
      # Stage 2 Nova 2 Lite token budget (also hard-coded)
      SIGNAL_DAILY_STAGE2_TOKENS = "100000"
      SIGNAL_RATE_PAUSE_SECS     = "2.0"
    } : {},
  )

  tags = merge(var.tags, { Agent = each.key })
}

# ── AgentCore Gateway (MCP endpoint — the tool surface agents call) ───────────
resource "aws_bedrockagentcore_gateway" "main" {
  # See the note on agent_runtime above: CreateGateway encrypts with the KMS key
  # using this role, so the inline policy must be in place first.
  depends_on = [aws_iam_role_policy.agentcore_runtime]

  name            = "${var.project}-gateway-${var.env}"
  description     = "MCP tool endpoint — exposes CRM Write Service and domain tools"
  role_arn        = aws_iam_role.agentcore_runtime.arn
  authorizer_type = "AWS_IAM" # Agents authenticate with their IAM identity

  protocol_configuration {
    mcp {
      instructions = "ImpulsoIQ tool surface. Call crm-write-service for all CRM writes."
      session_configuration {
        session_timeout_in_seconds = 3600
      }
    }
  }

  kms_key_arn = aws_kms_key.agentcore.arn
  tags        = var.tags
}

# Gateway target: CRM Write Service Lambda
resource "aws_bedrockagentcore_gateway_target" "crm_write" {
  gateway_identifier = aws_bedrockagentcore_gateway.main.gateway_id
  name               = "crm-write-service"
  description        = "Single-writer CRM tool — all DSQL writes go here"

  target_configuration {
    mcp {
      lambda {
        lambda_arn = var.crm_write_service_arn

        # The MCP tool contract every agent sees for CRM writes. The provider
        # requires this — agents discover the write surface from here rather
        # than each one hardcoding the payload shape.
        tool_schema {
          inline_payload {
            name        = "write_crm_record"
            description = "Write a record to Aurora DSQL through the single-writer CRM Write Service. Specialist agents never write to DSQL directly."

            input_schema {
              type        = "object"
              description = "CRM write request"

              property {
                name        = "operation"
                type        = "string"
                description = "Write operation, e.g. upsert_contact, upsert_activity, upsert_ticket, resolve_conversation"
                required    = true
              }
              property {
                name        = "tenantId"
                type        = "string"
                description = "Tenant identifier — every write is tenant-scoped"
                required    = true
              }
              property {
                name        = "payload"
                type        = "object"
                description = "Operation-specific record fields"
                required    = true
              }
              property {
                name        = "actorType"
                type        = "string"
                description = "human | agent"
                required    = false
              }
              property {
                name        = "actorId"
                type        = "string"
                description = "Identifier of the writing agent or user"
                required    = false
              }
            }

            output_schema {
              type        = "object"
              description = "CRM write result"

              property {
                name        = "ok"
                type        = "boolean"
                description = "Whether the write succeeded"
                required    = true
              }
              property {
                name        = "id"
                type        = "string"
                description = "Identifier of the written record"
                required    = false
              }
            }
          }
        }
      }
    }
  }

  # Lambda targets accept ONLY the GATEWAY_IAM_ROLE provider type -- the gateway
  # calls the Lambda as itself, using aws_iam_role.agentcore_runtime. The
  # caller_iam_credentials block maps to a different provider type and is
  # rejected outright for Lambda targets.
  credential_provider_configuration {
    gateway_iam_role {}
  }
}
