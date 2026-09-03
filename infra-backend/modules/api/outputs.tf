output "rest_api_id" { value = aws_api_gateway_rest_api.main.id }
output "rest_api_url" { value = aws_api_gateway_rest_api.main.execution_arn }
output "appsync_url" { value = aws_appsync_graphql_api.main.uris["GRAPHQL"] }
# event_bus_arn is now in data/outputs.tf — reference module.data.event_bus_arn in main.tf
output "state_machine_arn" { value = aws_sfn_state_machine.campaign.arn }
# Phase 4
output "voice_ws_url" {
  description = "WebSocket URL for the Ambient Interface voice bridge"
  value       = aws_apigatewayv2_stage.voice.invoke_url
}
