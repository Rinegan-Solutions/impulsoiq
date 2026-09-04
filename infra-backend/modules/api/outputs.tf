output "rest_api_id" { value = aws_api_gateway_rest_api.main.id }
# The STAGE invoke URL (https://<id>.execute-api.<region>.amazonaws.com/<env>).
# This used to output execution_arn, which is an ARN, not a URL -- it was
# written to SSM and injected into the SPA as VITE_API_URL, so every request
# was built against "arn:aws:execute-api:...".
output "rest_api_url" { value = aws_api_gateway_stage.main.invoke_url }
output "rest_api_execution_arn" { value = aws_api_gateway_rest_api.main.execution_arn }
output "appsync_url" { value = aws_appsync_graphql_api.main.uris["GRAPHQL"] }
# event_bus_arn is now in data/outputs.tf — reference module.data.event_bus_arn in main.tf
output "state_machine_arn" { value = aws_sfn_state_machine.campaign.arn }
# Phase 4
output "voice_ws_url" {
  description = "WebSocket URL for the Ambient Interface voice bridge"
  value       = aws_apigatewayv2_stage.voice.invoke_url
}
