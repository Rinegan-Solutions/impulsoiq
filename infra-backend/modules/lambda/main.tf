data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  # Construct ARNs without self-referencing the for_each resource
  crm_write_service_arn = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-crm-write-service-${var.env}"
  crm_read_service_arn  = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-crm-read-${var.env}"

  functions = {
    crm-write-service    = { handler = "handler.handler", timeout = 30, memory = 256 }
    crm-read             = { handler = "handler.handler", timeout = 15, memory = 256 }
    auth-authorizer      = { handler = "handler.handler", timeout = 10, memory = 128 }
    webhook-handler      = { handler = "handler.handler", timeout = 30, memory = 256 }
    campaign-trigger     = { handler = "handler.handler", timeout = 60, memory = 512 }
    sequence-step        = { handler = "handler.handler", timeout = 10, memory = 128 }
    execution-controller = { handler = "handler.handler", timeout = 60, memory = 256 }
    intent-service       = { handler = "handler.handler", timeout = 120, memory = 512 }
    org-check            = { handler = "handler.handler", timeout = 10, memory = 128 }
    lead-router          = { handler = "handler.handler", timeout = 30, memory = 256 }
    send-pause-enforcer  = { handler = "handler.handler", timeout = 15, memory = 128 }
    appsync-publisher    = { handler = "handler.handler", timeout = 30, memory = 256 }
    nurture-trigger      = { handler = "handler.handler", timeout = 30, memory = 256 }
    # Phase 3
    metering-aggregator = { handler = "handler.handler", timeout = 60, memory = 256 }
    evaluations-runner  = { handler = "handler.handler", timeout = 300, memory = 512 }
    # Phase 4
    voice-bridge = { handler = "handler.handler", timeout = 900, memory = 512 }
    # Phase 5
    template-launcher = { handler = "handler.handler", timeout = 30, memory = 256 }
    billing-service   = { handler = "handler.handler", timeout = 30, memory = 256 }
    # Phase 6
    registry-seeder = { handler = "handler.handler", timeout = 60, memory = 256 }
    a2a-handoff     = { handler = "handler.handler", timeout = 60, memory = 256 }
    # Phase 7
    connect-intake = { handler = "handler.handler", timeout = 15, memory = 256 }
    sla-monitor    = { handler = "handler.handler", timeout = 120, memory = 256 }
    # Phase 8
    csat-capture = { handler = "handler.handler", timeout = 15, memory = 128 }
    # Shim: AgentCore runtimes are not Lambdas and cannot be targeted by
    # EventBridge Scheduler or invoked with lambda:InvokeFunction. Anything that
    # needs to run an agent calls this and passes the agent ARN in the payload.
    # Timeout matches the longest scheduled agent run (deep research).
    agent-invoker = { handler = "handler.handler", timeout = 300, memory = 256 }
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

# AWSLambdaBasicExecutionRole grants CloudWatch Logs and NOTHING else. Every
# permission below is derived from an SDK client actually imported by a handler
# in codes/ -- not speculative.
#
# SCOPE NOTE: all 20 functions share one execution role, so this is the union of
# what any of them needs. That is weaker than a role per function: crm-read can
# technically start a Step Functions execution. Every statement is still bounded
# to impulsoiq-*-<env> resources, so the blast radius stays inside this
# environment. Splitting per function is the right follow-up, but it is a
# refactor of for_each, not a one-line change.
resource "aws_iam_role_policy" "lambda" {
  name = "${var.project}-lambda-policy-${var.env}"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # @aws-sdk/client-dynamodb — imported by 22 handlers
        Sid    = "DynamoDbData"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
          "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
          "dynamodb:DescribeTable",
        ]
        Resource = [
          "arn:aws:dynamodb:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:table/${var.project}-*-${var.env}",
          "arn:aws:dynamodb:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:table/${var.project}-*-${var.env}/index/*",
        ]
      },
      {
        # Required by the three aws_lambda_event_source_mapping resources below.
        # Without these, CreateEventSourceMapping fails at APPLY time with
        # "Cannot access stream ... ensure the role can perform GetRecords,
        # GetShardIterator, DescribeStream, and ListStreams" -- Lambda validates
        # the role up front rather than failing later at invoke time.
        # Wildcarded on /stream/* because the stream ARN carries a timestamp and
        # changes whenever the stream is disabled and re-enabled.
        Sid    = "DynamoDbStreams"
        Effect = "Allow"
        Action = [
          "dynamodb:GetRecords", "dynamodb:GetShardIterator",
          "dynamodb:DescribeStream",
        ]
        Resource = "arn:aws:dynamodb:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:table/${var.project}-*-${var.env}/stream/*"
      },
      {
        # dynamodb:ListStreams admits no resource scope.
        Sid      = "DynamoDbListStreams"
        Effect   = "Allow"
        Action   = "dynamodb:ListStreams"
        Resource = "*"
      },
      {
        # @aws-sdk/client-lambda (14 handlers) — the CRM write/read single-writer
        # pattern is function-to-function invocation.
        Sid      = "InvokeSiblingFunctions"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-*-${var.env}"
      },
      {
        # @aws-sdk/client-sfn (7 handlers). SendTaskSuccess/Failure are how the
        # voice graph resumes after a CALL-E webhook; they are authorised against
        # the state machine, not the execution.
        Sid    = "StepFunctions"
        Effect = "Allow"
        Action = [
          "states:StartExecution", "states:DescribeExecution",
          "states:StopExecution",
          "states:SendTaskSuccess", "states:SendTaskFailure",
          "states:SendTaskHeartbeat",
        ]
        Resource = [
          "arn:aws:states:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:stateMachine:${var.project}-*-${var.env}",
          "arn:aws:states:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:execution:${var.project}-*-${var.env}:*",
        ]
      },
      {
        # agent-invoker calls the AgentCore DATA plane. This is a different
        # service from bedrock: InvokeAgentRuntime, not InvokeModel.
        Sid    = "InvokeAgentRuntimes"
        Effect = "Allow"
        Action = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = [
          "arn:aws:bedrock-agentcore:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:runtime/${var.project}_*_${var.env}",
          "arn:aws:bedrock-agentcore:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:runtime/${var.project}_*_${var.env}/*",
        ]
      },
      {
        # @aws-sdk/client-bedrock-runtime (4 handlers) — InvokeModel + Converse.
        # Foundation model ARNs are AWS-owned, so this cannot be account-scoped.
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream",
          "bedrock:Converse", "bedrock:ConverseStream",
        ]
        Resource = "*"
      },
      {
        # @aws-sdk/client-ssm — the *_SSM_PATH env vars above are read at cold
        # start specifically to avoid module dependency cycles.
        Sid      = "SsmRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/${var.env}/*"
      },
      {
        Sid      = "AppSecretRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.app_secret_arn
      },
      {
        # @aws-sdk/client-dsql + DsqlSigner — used by crm-read, crm-write-service,
        # org-check, registry-seeder, sla-monitor, template-launcher. The signer
        # mints a connection token; DbConnectAdmin is what authorises it.
        Sid      = "DsqlConnect"
        Effect   = "Allow"
        Action   = ["dsql:DbConnectAdmin", "dsql:DbConnect"]
        Resource = "arn:aws:dsql:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:cluster/*"
      },
      {
        # @aws-sdk/client-eventbridge — PutEventsCommand
        Sid      = "EventBridgePut"
        Effect   = "Allow"
        Action   = "events:PutEvents"
        Resource = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:event-bus/${var.project}-*-${var.env}"
      },
      {
        # @aws-sdk/client-appsync — appsync-publisher pushes the live agent feed
        Sid      = "AppSyncPublish"
        Effect   = "Allow"
        Action   = "appsync:GraphQL"
        Resource = "arn:aws:appsync:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:apis/*"
      },
      {
        # @aws-sdk/client-apigatewaymanagementapi — PostToConnectionCommand from
        # voice-bridge back to connected WebSocket clients.
        Sid      = "WebSocketPostBack"
        Effect   = "Allow"
        Action   = "execute-api:ManageConnections"
        Resource = "arn:aws:execute-api:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:*/${var.env}/*"
      },
      {
        # @aws-sdk/client-cognito-identity-provider — AdminAddUserToGroupCommand.
        # The pool ARN is not available here without a lambda->auth dependency
        # cycle (the pool id is read from SSM at cold start for the same reason),
        # so this is scoped to the account's pools in this region.
        Sid    = "CognitoAdmin"
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminGetUser",
          "cognito-idp:AdminCreateUser", "cognito-idp:AdminSetUserPassword",
        ]
        Resource = "arn:aws:cognito-idp:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:userpool/*"
      },
    ]
  })
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
        APP_SECRET_ARN = var.app_secret_arn
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
      contains(["metering-aggregator", "evaluations-runner", "crm-read", "billing-service"], each.key) ? {
        METERING_TABLE  = var.metering_table
        REPORTING_TABLE = var.reporting_table
      } : {},
      each.key == "billing-service" ? {
        STRIPE_PRICE_STARTER_MONTHLY         = var.stripe_price_starter_monthly
        STRIPE_PRICE_STARTER_ANNUAL          = var.stripe_price_starter_annual
        STRIPE_PRICE_GROWTH_MONTHLY          = var.stripe_price_growth_monthly
        STRIPE_PRICE_GROWTH_ANNUAL           = var.stripe_price_growth_annual
        STRIPE_PRICE_PACK_CALL_MINUTES       = var.stripe_price_pack_call_minutes
        STRIPE_PRICE_PACK_ENRICHMENT_LOOKUPS = var.stripe_price_pack_enrichment
        STRIPE_PRICE_PACK_CONCURRENT_RUNS    = var.stripe_price_pack_concurrent_runs
      } : {},
      contains(["lead-router", "campaign-trigger", "webhook-handler", "execution-controller", "intent-service", "template-launcher"], each.key) ? {
        STATE_MACHINE_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/state_machine_arn"
      } : {},
      each.key == "intent-service" ? {
        AGENT_INVOKER_ARN          = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-agent-invoker-${var.env}"
        CLARIFICATION_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/clarification_agent_arn"
        DEEP_RESEARCH_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/deep_research_agent_arn"
      } : {},
      each.key == "voice-bridge" ? {
        AMBIENT_AGENT_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/ambient_agent_arn"
        # $connect verifies the browser's ID token; its audience is the web client.
        USER_POOL_CLIENT_ID_SSM_PATH = "/impulsoiq/${var.env}/backend/cognito_client_id"
      } : {},
      each.key == "a2a-handoff" ? {
        TEMPLATE_LAUNCHER_ARN = "arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-template-launcher-${var.env}"
      } : {},
      each.key == "connect-intake" ? {
        TRIAGE_AGENT_ARN_SSM_PATH     = "/impulsoiq/${var.env}/backend/triage_agent_arn"
        RESOLUTION_AGENT_ARN_SSM_PATH = "/impulsoiq/${var.env}/backend/resolution_agent_arn"
      } : {},
      each.key == "execution-controller" ? {
        CALLE_BASE_URL = var.calle_base_url
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
