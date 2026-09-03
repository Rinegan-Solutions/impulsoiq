data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  # Construct ARNs without self-referencing the for_each resource
  crm_write_service_arn = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-crm-write-service-${var.env}"
  crm_read_service_arn  = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-crm-read-${var.env}"

  functions = {
    crm-write-service   = { handler = "handler.handler", timeout = 30, memory = 256 }
    crm-read            = { handler = "handler.handler", timeout = 15, memory = 256 }
    auth-authorizer     = { handler = "handler.handler", timeout = 10, memory = 128 }
    webhook-handler     = { handler = "handler.handler", timeout = 30, memory = 256 }
    campaign-trigger    = { handler = "handler.handler", timeout = 60, memory = 512 }
    org-check           = { handler = "handler.handler", timeout = 10, memory = 128 }
    lead-router         = { handler = "handler.handler", timeout = 30, memory = 256 }
    send-pause-enforcer = { handler = "handler.handler", timeout = 15, memory = 128 }
    appsync-publisher   = { handler = "handler.handler", timeout = 30, memory = 256 }
    nurture-trigger     = { handler = "handler.handler", timeout = 30, memory = 256 }
    # Phase 3
    metering-aggregator = { handler = "handler.handler", timeout = 60, memory = 256 }
    evaluations-runner  = { handler = "handler.handler", timeout = 300, memory = 512 }
    # Phase 4
    voice-bridge = { handler = "handler.handler", timeout = 900, memory = 512 }
    # Phase 5
    template-launcher = { handler = "handler.handler", timeout = 30, memory = 256 }
    # Phase 6
    registry-seeder = { handler = "handler.handler", timeout = 60, memory = 256 }
    a2a-handoff     = { handler = "handler.handler", timeout = 60, memory = 256 }
    # Phase 7
    connect-intake = { handler = "handler.handler", timeout = 15, memory = 256 }
    sla-monitor    = { handler = "handler.handler", timeout = 120, memory = 256 }
    # Phase 8
    csat-capture = { handler = "handler.handler", timeout = 15, memory = 128 }
    # tenant-provisioner is created in modules/auth (needs cognito pool ARN); listed here
    # only so its dist.zip is built by the same buildspec loop.
  }
}

resource "aws_iam_role" "lambda" {
  name = "${var.project}-lambda-${var.env}"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "fn" {
  for_each = local.functions

  function_name = "${var.project}-${each.key}-${var.env}"
  role          = aws_iam_role.lambda.arn
  handler       = each.value.handler
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  timeout       = each.value.timeout
  memory_size   = each.value.memory

  filename         = "${path.module}/codes/${each.key}/dist.zip"
  source_code_hash = filebase64sha256("${path.module}/codes/${each.key}/dist.zip")

  environment {
    variables = merge(
      {
        DSQL_ENDPOINT  = var.dsql_endpoint
        DYNAMODB_TABLE = var.dynamodb_table
        ENV            = var.env
        # Authorizer reads pool ID from SSM at cold start — no auth→lambda dep cycle
        USER_POOL_ID_SSM_PATH = "/impulsoiq/${var.env}/backend/cognito_user_pool_id"
        CRM_WRITE_SERVICE_ARN = local.crm_write_service_arn
        CRM_READ_SERVICE_ARN  = local.crm_read_service_arn
        # Phase 3: reporting + metering tables (SSM paths to avoid module dep cycle)
        REPORTING_TABLE_SSM_PATH = "/impulsoiq/${var.env}/backend/reporting_table"
        METERING_TABLE_SSM_PATH  = "/impulsoiq/${var.env}/backend/metering_table"
      },
      # Per-function extras — use SSM paths for values only known after other modules
      # apply (avoids creating lambda→api circular dependency).
      each.key == "appsync-publisher" ? {
        # SSM path resolved at cold start — no module dependency needed
        APPSYNC_URL_SSM_PATH = "/impulsoiq/${var.env}/backend/appsync_url"
      } : {},
      contains(["lead-router", "campaign-trigger", "webhook-handler"], each.key) ? {
        STATE_MACHINE_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/state_machine_arn"
      } : {},
      contains(["metering-aggregator", "evaluations-runner"], each.key) ? {
        METERING_TABLE  = var.metering_table
        REPORTING_TABLE = var.reporting_table
      } : {},
      each.key == "voice-bridge" ? {
        AMBIENT_AGENT_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/ambient_agent_arn"
      } : {},
      each.key == "a2a-handoff" ? {
        TEMPLATE_LAUNCHER_ARN = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-template-launcher-${var.env}"
      } : {},
      each.key == "connect-intake" ? {
        TRIAGE_AGENT_ARN_SSM_PATH     = "/impulsoiq/${var.env}/backend/triage_agent_arn"
        RESOLUTION_AGENT_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/resolution_agent_arn"
      } : {},
      each.key == "csat-capture" ? {
        CONNECT_INTAKE_ARN = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-connect-intake-${var.env}"
      } : {},
    )
  }

  tags = var.tags
}

# ── DynamoDB Streams triggers ──────────────────────────────────────────────────

# appsync-publisher: Phase 2G live feed — consumes the events table stream
resource "aws_lambda_event_source_mapping" "appsync_publisher_stream" {
  event_source_arn  = var.dynamodb_stream_arn
  function_name     = aws_lambda_function.fn["appsync-publisher"].arn
  starting_position = "LATEST"
  batch_size        = 10
  enabled           = true

  filter_criteria {
    filter {
      # Only events related to agent_run, activity, or memory entities
      pattern = jsonencode({
        dynamodb = {
          NewImage = {
            entityType = {
              S = ["agent_run", "activity", "memory", "call_result"]
            }
          }
        }
      })
    }
  }
}

# metering-aggregator: Phase 3C usage counters — also consumes the events stream
resource "aws_lambda_event_source_mapping" "metering_aggregator_stream" {
  event_source_arn  = var.dynamodb_stream_arn
  function_name     = aws_lambda_function.fn["metering-aggregator"].arn
  starting_position = "LATEST"
  batch_size        = 25
  enabled           = true

  filter_criteria {
    filter {
      pattern = jsonencode({
        dynamodb = {
          NewImage = {
            entityType = {
              S = ["agent_run", "activity", "call_result", "memory"]
            }
          }
        }
      })
    }
  }
}

# a2a-handoff: Phase 6C — DynamoDB Streams trigger for deal Closed Won events
resource "aws_lambda_event_source_mapping" "a2a_handoff_stream" {
  event_source_arn  = var.dynamodb_stream_arn
  function_name     = aws_lambda_function.fn["a2a-handoff"].arn
  starting_position = "LATEST"
  batch_size        = 5
  enabled           = true

  filter_criteria {
    filter {
      pattern = jsonencode({
        dynamodb = {
          NewImage = {
            entityType = { S = ["deal"] }
            eventType  = { S = ["updated"] }
          }
        }
      })
    }
  }
}
