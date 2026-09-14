# ─── REST API surface ─────────────────────────────────────────────────────────
#
# Until this file existed, aws_api_gateway_rest_api.main had a single "/"
# resource, no methods, and no deployed stage -- the eight HTTP-facing Lambdas
# had no way to be called over HTTP at all, and the SPA's every data request
# fell through CloudFront's SPA rewrite and came back as index.html.
#
# SHAPE OF THE API
# crm-read and crm-write-service dispatch on an `operation` field in the request
# BODY, not on path or method. That is deliberate -- CLAUDE.md makes the single
# CRM Write Service a hard architectural rule, and agents invoke the same
# Lambdas directly with {operation, payload}. So these are POST endpoints that
# take an operation envelope, NOT REST resources. Modelling /contacts,
# /deals, ... as separate resources would mean a second, divergent contract for
# the same data.
#
# AUTH
# COGNITO_USER_POOLS on everything a signed-in user calls. Five endpoints are
# deliberately public because the caller cannot have a token:
#   org-check        -- called during sign-up, before an account exists
#   webhooks/calle   -- called by CALL-E, an external service
#   webhooks-stripe  -- called by Stripe; verified by signature, not Cognito
#   csat             -- called from a survey link in an email
#   invite-lookup    -- opened from an invitation email, before an account exists
#
# CORS
# Access-Control-Allow-Origin is "*" with credentials OFF. The API is
# authorised by a bearer token in the Authorization header, not by cookies, so
# CORS is not the security boundary here and "*" costs nothing. It also avoids
# a real problem: prod serves BOTH the apex and www, and a MOCK integration can
# only return one static origin -- so an allowlist would silently break
# whichever host was not chosen, plus localhost during development.

locals {
  # authorized = false means the caller cannot hold a Cognito token yet.
  rest_routes = {
    "crm-read" = {
      lambda     = "crm-read"
      method     = "POST"
      authorized = true
    }
    "crm-write" = {
      lambda     = "crm-write-service"
      method     = "POST"
      authorized = true
    }
    "campaigns" = {
      lambda     = "campaign-trigger"
      method     = "POST"
      authorized = true
    }
    "control" = {
      lambda     = "execution-controller"
      method     = "POST"
      authorized = true
    }
    "intent" = {
      lambda     = "intent-service"
      method     = "POST"
      authorized = true
    }
    "leads" = {
      lambda     = "lead-router"
      method     = "POST"
      authorized = true
    }
    "templates" = {
      lambda     = "template-launcher"
      method     = "POST"
      authorized = true
    }
    "org-check" = {
      lambda     = "org-check"
      method     = "GET"
      authorized = false
    }
    "webhooks-calle" = {
      lambda     = "webhook-handler"
      method     = "POST"
      authorized = false
    }
    "csat" = {
      lambda     = "csat-capture"
      method     = "POST"
      authorized = false
    }
    "billing" = {
      lambda     = "billing-service"
      method     = "POST"
      authorized = true
    }
    "webhooks-stripe" = {
      lambda     = "billing-service"
      method     = "POST"
      authorized = false
    }
    "invitations" = {
      lambda     = "invitation-service"
      method     = "POST"
      authorized = true
    }
    # Resolving an invite token happens on the sign-up screen, before the
    # invitee has an account -- there is no token they could present. The raw
    # invitation token IS the credential, and the handler answers every failure
    # identically so this cannot be used to probe for valid ones.
    "invite-lookup" = {
      lambda     = "invitation-service"
      method     = "POST"
      authorized = false
    }
  }
}

# ── Resources (one flat path segment each) ────────────────────────────────────
resource "aws_api_gateway_resource" "route" {
  for_each = local.rest_routes

  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = each.key
}

# ── Methods ───────────────────────────────────────────────────────────────────
resource "aws_api_gateway_method" "route" {
  for_each = local.rest_routes

  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.route[each.key].id
  http_method   = each.value.method
  authorization = each.value.authorized ? "COGNITO_USER_POOLS" : "NONE"
  authorizer_id = each.value.authorized ? aws_api_gateway_authorizer.cognito.id : null
}

# ── Integrations ──────────────────────────────────────────────────────────────
# AWS_PROXY passes the raw event through and requires the Lambda to return
# {statusCode, headers, body}. The integration itself is ALWAYS POST -- that is
# how Lambda is invoked, and is unrelated to the method the client used.
resource "aws_api_gateway_integration" "route" {
  for_each = local.rest_routes

  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.route[each.key].id
  http_method             = aws_api_gateway_method.route[each.key].http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.region}:lambda:path/2015-03-31/functions/${var.lambda_function_arns[each.value.lambda]}/invocations"
}

# ── Permission for API Gateway to invoke each Lambda ──────────────────────────
# source_arn is scoped to this API, this method and this path -- without it any
# API in the account could invoke these functions.
resource "aws_lambda_permission" "apigw" {
  for_each = local.rest_routes

  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_arns[each.value.lambda]
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/${each.value.method}/${each.key}"
}

# ── CORS preflight ────────────────────────────────────────────────────────────
# A MOCK integration answers OPTIONS entirely inside API Gateway -- no Lambda
# invocation, so preflight costs nothing.
resource "aws_api_gateway_method" "options" {
  for_each = local.rest_routes

  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.route[each.key].id
  http_method   = "OPTIONS"
  authorization = "NONE" # preflight carries no Authorization header, by spec
}

resource "aws_api_gateway_integration" "options" {
  for_each = local.rest_routes

  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.route[each.key].id
  http_method = aws_api_gateway_method.options[each.key].http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = jsonencode({ statusCode = 200 })
  }
}

resource "aws_api_gateway_method_response" "options" {
  for_each = local.rest_routes

  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.route[each.key].id
  http_method = aws_api_gateway_method.options[each.key].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
    "method.response.header.Access-Control-Max-Age"       = true
  }
}

resource "aws_api_gateway_integration_response" "options" {
  for_each = local.rest_routes

  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.route[each.key].id
  http_method = aws_api_gateway_method.options[each.key].http_method
  status_code = aws_api_gateway_method_response.options[each.key].status_code

  response_parameters = {
    # x-impulsoiq-tenant is the workspace the browser is addressing; without it
    # in this list the browser blocks every API call at preflight.
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,x-impulsoiq-tenant'"
    "method.response.header.Access-Control-Allow-Methods" = "'${each.value.method},OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    # Cache preflight for a day so the browser stops re-asking on every call.
    "method.response.header.Access-Control-Max-Age" = "'86400'"
  }

  depends_on = [aws_api_gateway_integration.options]
}

# API Gateway 4xx/5xx (including 504 integration timeouts) never reach a Lambda,
# so they would otherwise have no CORS headers. The browser then reports CORS
# instead of the real timeout.
locals {
  cors_gateway_headers = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,x-impulsoiq-tenant'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "cors_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  response_type = "DEFAULT_4XX"

  response_parameters = local.cors_gateway_headers
}

resource "aws_api_gateway_gateway_response" "cors_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  response_type = "DEFAULT_5XX"

  response_parameters = local.cors_gateway_headers
}

# ── Deployment + stage ────────────────────────────────────────────────────────
# API Gateway deployments are immutable snapshots. Without a trigger that
# changes when the routes change, Terraform reuses the existing deployment and
# route edits never reach the stage -- a silent, confusing failure.
resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeploy = sha1(jsonencode([
      local.rest_routes,
      aws_api_gateway_resource.route,
      aws_api_gateway_method.route,
      aws_api_gateway_integration.route,
      aws_api_gateway_method.options,
      aws_api_gateway_integration.options,
      aws_api_gateway_integration_response.options,
      aws_api_gateway_gateway_response.cors_4xx,
      aws_api_gateway_gateway_response.cors_5xx,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "main" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  deployment_id = aws_api_gateway_deployment.main.id
  stage_name    = var.env
  tags          = var.tags
}

resource "aws_api_gateway_method_settings" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  stage_name  = aws_api_gateway_stage.main.stage_name
  method_path = "*/*"

  settings {
    metrics_enabled        = true
    logging_level          = "INFO"
    throttling_burst_limit = 200
    throttling_rate_limit  = 100
  }
}
