terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.18" }
  }
  required_version = ">= 1.9"
  # backend "s3" {} is declared in backend.tf — a module may only have one.
}

provider "aws" { region = var.aws_region }

locals {
  project = "impulsoiq"
  tags    = { Project = local.project, Env = var.env, ManagedBy = "terraform" }
}

# ─── Module dependency order ──────────────────────────────────────────────────
# data → lambda → auth → api → agentcore
#                           ↗ (agent runtime ARNs)
# No cycles: EventBridge bus is in data/ so agentcore can reference it directly.
# Dynamic Lambda values (AppSync URL, SFN ARN) are SSM-resolved at cold start.

# ── Networking ───────────────────────────────────────────────────────────────
# No VPC module: DSQL, Bedrock, Cognito, S3, and API Gateway are all reachable
# from Lambda without one, so there is deliberately no networking module. If a
# future resource needs private networking, add it here.

# ── Data layer: DSQL, DynamoDB (+ GSIs), S3, EventBridge bus ─────────────────
module "data" {
  source  = "./modules/data"
  project = local.project
  env     = var.env
  tags    = local.tags
}

# ── Lambda functions ──────────────────────────────────────────────────────────
# Depends only on data. Dynamic config (AppSync URL, SFN ARN) read from SSM.
module "lambda" {
  source  = "./modules/lambda"
  project = local.project
  env     = var.env
  tags    = local.tags

  dsql_endpoint       = module.data.dsql_cluster_endpoint
  dynamodb_table      = module.data.dynamodb_table_name
  dynamodb_stream_arn = module.data.dynamodb_stream_arn
  # Phase 3: lambda depends on data only — no cycle
  metering_table  = module.data.metering_table_name
  reporting_table = module.data.reporting_table_name
}

# ── Auth: Cognito, RBAC groups, tenant-provisioner trigger ───────────────────
# Depends on lambda for crm_write_service_arn (provisioner writes tenants).
module "auth" {
  source  = "./modules/auth"
  project = local.project
  env     = var.env
  tags    = local.tags

  crm_write_service_arn = module.lambda.crm_write_service_arn
}

# ── API: APIGW, AppSync, SFN, SES, EventBridge rules ─────────────────────────
# Depends on auth (pool IDs), lambda (Lambda ARNs for SFN + SES alarms),
# and agentcore (agent runtime ARNs for SFN states).
module "api" {
  source  = "./modules/api"
  project = local.project
  env     = var.env
  tags    = local.tags

  user_pool_id  = module.auth.user_pool_id
  user_pool_arn = module.auth.user_pool_arn

  # Phase 2: SFN + SES wiring
  crm_write_service_arn         = module.lambda.crm_write_service_arn
  research_enrichment_agent_arn = module.agentcore.research_enrichment_runtime_arn
  outreach_agent_arn            = module.agentcore.outreach_runtime_arn
  voice_agent_arn               = module.agentcore.voice_runtime_arn
  webhook_handler_arn           = module.lambda.function_arns["webhook-handler"]
  send_pause_enforcer_arn       = module.lambda.function_arns["send-pause-enforcer"]
  nurture_trigger_lambda_arn    = module.lambda.function_arns["nurture-trigger"]
  agents_event_bus_name         = module.data.event_bus_name
  # Phase 3 scheduler targets — agentcore runtime IDs used as Lambda ARN proxies
  forecasting_agent_lambda_arn  = module.agentcore.forecasting_insight_runtime_arn
  hygiene_agent_lambda_arn      = module.agentcore.data_hygiene_runtime_arn
  evaluations_runner_lambda_arn = module.lambda.function_arns["evaluations-runner"]
  # Phase 4
  voice_bridge_lambda_arn = module.lambda.function_arns["voice-bridge"]
  # Phase 4C — disabled by default until legal review is complete per source
  signal_listening_lambda_arn = module.agentcore.signal_listening_runtime_arn
  # Phase 7
  sla_monitor_lambda_arn = module.lambda.function_arns["sla-monitor"]
  # Phase 9 — runs Sunday 05:00, before Forecasting Agent (07:00), so support signals are ready
  support_insight_lambda_arn = module.agentcore.support_insight_runtime_arn
}

# ── Support (Amazon Connect + queues + contact flows) — Phase 7 ───────────────
module "support" {
  source  = "./modules/support"
  project = local.project
  env     = var.env
  tags    = local.tags

  connect_intake_lambda_arn = module.lambda.function_arns["connect-intake"]
}

resource "aws_ssm_parameter" "triage_agent_arn" {
  name  = "/impulsoiq/${var.env}/backend/triage_agent_arn"
  type  = "String"
  value = module.agentcore.triage_escalation_runtime_arn
  tags  = local.tags
}

resource "aws_ssm_parameter" "resolution_agent_arn" {
  name  = "/impulsoiq/${var.env}/backend/resolution_agent_arn"
  type  = "String"
  value = module.agentcore.resolution_runtime_arn
  tags  = local.tags
}

resource "aws_ssm_parameter" "support_insight_agent_arn" {
  name  = "/impulsoiq/${var.env}/backend/support_insight_agent_arn"
  type  = "String"
  value = module.agentcore.support_insight_runtime_arn
  tags  = local.tags
}

resource "aws_ssm_parameter" "connect_instance_id" {
  name  = "/impulsoiq/${var.env}/backend/connect_instance_id"
  type  = "String"
  value = module.support.connect_instance_id
  tags  = local.tags
}

# ── AgentCore: Runtime, Memory, Gateway, Identity ────────────────────────────
# Depends on lambda (write/read service ARNs) and data (event bus + DynamoDB).
module "agentcore" {
  source  = "./modules/agentcore"
  project = local.project
  env     = var.env
  tags    = local.tags

  crm_write_service_arn = module.lambda.crm_write_service_arn
  crm_read_service_arn  = module.lambda.function_arns["crm-read"]
  dynamodb_table        = module.data.dynamodb_table_name
  agents_event_bus_arn  = module.data.event_bus_arn
  # Phase 3
  reporting_table = module.data.reporting_table_name
  metering_table  = module.data.metering_table_name
}

# ── SSM parameters — written after all modules apply ─────────────────────────
# These are the SSM-based discovery values that Lambda functions read at cold start.

resource "aws_ssm_parameter" "api_url" {
  name  = "/impulsoiq/${var.env}/backend/api_url"
  type  = "String"
  value = module.api.rest_api_url
  tags  = local.tags
}

resource "aws_ssm_parameter" "appsync_url" {
  name  = "/impulsoiq/${var.env}/backend/appsync_url"
  type  = "String"
  value = module.api.appsync_url
  tags  = local.tags
}

# appsync-publisher Lambda reads APPSYNC_URL_SSM_PATH at cold start → this value
resource "aws_ssm_parameter" "state_machine_arn" {
  name  = "/impulsoiq/${var.env}/backend/state_machine_arn"
  type  = "String"
  value = module.api.state_machine_arn
  tags  = local.tags
}

resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name  = "/impulsoiq/${var.env}/backend/cognito_user_pool_id"
  type  = "String"
  value = module.auth.user_pool_id
  tags  = local.tags
}

resource "aws_ssm_parameter" "cognito_client_id" {
  name  = "/impulsoiq/${var.env}/backend/cognito_client_id"
  type  = "String"
  value = module.auth.user_pool_client_id
  tags  = local.tags
}

resource "aws_ssm_parameter" "agentcore_gateway_endpoint" {
  name  = "/impulsoiq/${var.env}/backend/agentcore_gateway_endpoint"
  type  = "String"
  value = module.agentcore.gateway_endpoint
  tags  = local.tags
}

resource "aws_ssm_parameter" "event_bus_arn" {
  name  = "/impulsoiq/${var.env}/backend/event_bus_arn"
  type  = "String"
  value = module.data.event_bus_arn
  tags  = local.tags
}

# Phase 3: SSM parameters for table names (Lambda cold-start discovery)
resource "aws_ssm_parameter" "reporting_table" {
  name  = "/impulsoiq/${var.env}/backend/reporting_table"
  type  = "String"
  value = module.data.reporting_table_name
  tags  = local.tags
}

resource "aws_ssm_parameter" "metering_table" {
  name  = "/impulsoiq/${var.env}/backend/metering_table"
  type  = "String"
  value = module.data.metering_table_name
  tags  = local.tags
}

# Phase 4
resource "aws_ssm_parameter" "voice_ws_url" {
  name  = "/impulsoiq/${var.env}/backend/voice_ws_url"
  type  = "String"
  value = module.api.voice_ws_url
  tags  = local.tags
}

resource "aws_ssm_parameter" "ambient_agent_arn" {
  name  = "/impulsoiq/${var.env}/backend/ambient_agent_arn"
  type  = "String"
  value = module.agentcore.ambient_interface_runtime_arn
  tags  = local.tags
}
