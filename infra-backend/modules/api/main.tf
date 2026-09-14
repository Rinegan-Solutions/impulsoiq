# REST API Gateway
resource "aws_api_gateway_rest_api" "main" {
  name        = "${var.project}-api-${var.env}"
  description = "ImpulsoIQ REST API"
  endpoint_configuration { types = ["REGIONAL"] }
  tags = var.tags
}

resource "aws_api_gateway_authorizer" "cognito" {
  name          = "cognito"
  rest_api_id   = aws_api_gateway_rest_api.main.id
  type          = "COGNITO_USER_POOLS"
  provider_arns = [var.user_pool_arn]
}

# AppSync for real-time Agent Control Panel
resource "aws_appsync_graphql_api" "main" {
  name                = "${var.project}-appsync-${var.env}"
  authentication_type = "AMAZON_COGNITO_USER_POOLS"
  # Schema is an argument on the API itself — there is no separate
  # aws_appsync_graphql_schema resource in the AWS provider.
  schema = file("${path.module}/appsync-schema.graphql")

  additional_authentication_provider {
    authentication_type = "AWS_IAM"
  }

  user_pool_config {
    aws_region     = data.aws_region.current.region
    user_pool_id   = var.user_pool_id
    default_action = "ALLOW"
  }

  tags = var.tags
}

# NOTE: there is no separate aws_appsync_graphql_schema resource — the schema
# is an argument on aws_appsync_graphql_api itself (see the `schema` attribute
# set above from appsync-schema.graphql).

# NONE data source — used by the local resolver pattern for subscription fanout
resource "aws_appsync_datasource" "none" {
  api_id           = aws_appsync_graphql_api.main.id
  name             = "NoneDataSource"
  type             = "NONE"
  service_role_arn = null
}

# JS resolver for publishAgentAction mutation (APPSYNC_JS runtime — not VTL)
resource "aws_appsync_resolver" "publish_agent_action" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Mutation"
  field       = "publishAgentAction"
  data_source = aws_appsync_datasource.none.name
  kind        = "UNIT"

  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }

  code = file("${path.module}/resolvers/publish-agent-action.js")
}

resource "aws_appsync_resolver" "on_agent_action" {
  api_id      = aws_appsync_graphql_api.main.id
  type        = "Subscription"
  field       = "onAgentAction"
  data_source = aws_appsync_datasource.none.name
  kind        = "UNIT"

  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }

  code = file("${path.module}/resolvers/on-agent-action.js")
}

data "aws_region" "current" {}

# EventBridge bus is provisioned in the data module so both api and agentcore
# can reference it without a circular dependency. See data/main.tf.
