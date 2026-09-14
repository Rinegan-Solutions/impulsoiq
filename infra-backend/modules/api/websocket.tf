# ── WebSocket API Gateway — Phase 4A voice bridge ────────────────────────────
#
# Provides the real-time WebSocket endpoint the browser connects to for the
# Ambient Interface (Nova Sonic) voice session.
#
# Routes:
#   $connect    → voice-bridge Lambda (validates JWT, stores connection)
#   $disconnect → voice-bridge Lambda (cleanup)
#   $default    → voice-bridge Lambda (acks, then Event-invokes itself to run
#                 the agent and PostToConnection). Integration timeout is 29s.

resource "aws_apigatewayv2_api" "voice" {
  name                       = "${var.project}-voice-ws-${var.env}"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
  description                = "ImpulsoIQ Ambient Interface WebSocket (Nova Sonic bridge)"
  tags                       = var.tags
}

# ── Lambda integration ────────────────────────────────────────────────────────
resource "aws_apigatewayv2_integration" "voice_bridge" {
  api_id                 = aws_apigatewayv2_api.voice.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.voice_bridge_lambda_arn
  payload_format_version = "1.0"
}

# ── Routes ────────────────────────────────────────────────────────────────────
# No API Gateway authorizer on $connect: voice-bridge verifies the Cognito ID
# token (?token=) itself and returns 401/403 to reject the upgrade, then binds
# the verified workspace to the connection record. Doing it in the integration
# keeps the JWKS/SSM logic in one place and lets $default read the identity
# from that record instead of trusting anything a client sends.
resource "aws_apigatewayv2_route" "connect" {
  api_id    = aws_apigatewayv2_api.voice.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.voice_bridge.id}"
}

resource "aws_apigatewayv2_route" "disconnect" {
  api_id    = aws_apigatewayv2_api.voice.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.voice_bridge.id}"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.voice.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.voice_bridge.id}"
}

# ── Stage + deployment ────────────────────────────────────────────────────────
resource "aws_apigatewayv2_stage" "voice" {
  api_id      = aws_apigatewayv2_api.voice.id
  name        = var.env
  auto_deploy = true

  default_route_settings {
    logging_level          = "INFO"
    data_trace_enabled     = false
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  tags = var.tags
}

# ── Permission: API Gateway can invoke the voice-bridge Lambda ───────────────
resource "aws_lambda_permission" "apigw_voice_bridge" {
  statement_id  = "AllowAPIGatewayVoiceBridge"
  action        = "lambda:InvokeFunction"
  function_name = var.voice_bridge_lambda_arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.voice.execution_arn}/*/*"
}

# ── IAM: voice-bridge Lambda can post back to connected clients ───────────────
resource "aws_iam_policy" "voice_bridge_connections" {
  name = "${var.project}-voice-bridge-connections-${var.env}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "execute-api:ManageConnections"
      Resource = "${aws_apigatewayv2_api.voice.execution_arn}/*/*/@connections/*"
    }]
  })
}
