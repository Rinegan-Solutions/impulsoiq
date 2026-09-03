# Root outputs — surfaced for operators and for `terraform output` inspection.
#
# NOTE: SSM parameters are written explicitly by aws_ssm_parameter resources in
# main.tf, not derived from these outputs. Terraform owns those paths as real
# resources so they are tracked in state and cleaned up on destroy.

output "api_url" { value = module.api.rest_api_url }
output "appsync_url" { value = module.api.appsync_url }
output "voice_ws_url" { value = module.api.voice_ws_url }
output "state_machine_arn" { value = module.api.state_machine_arn }

output "user_pool_id" { value = module.auth.user_pool_id }
output "user_pool_client_id" { value = module.auth.user_pool_client_id }

output "dsql_cluster_endpoint" { value = module.data.dsql_cluster_endpoint }
output "dynamodb_table_name" { value = module.data.dynamodb_table_name }
output "reporting_table_name" { value = module.data.reporting_table_name }
output "metering_table_name" { value = module.data.metering_table_name }
output "event_bus_name" { value = module.data.event_bus_name }

output "agentcore_gateway_endpoint" { value = module.agentcore.gateway_endpoint }
output "agentcore_memory_store_id" { value = module.agentcore.memory_store_id }

output "agent_runtime_arns" {
  description = "Map of agent key → AgentCore runtime ARN (14 agents across phases 1–9)"
  value       = module.agentcore.agent_runtime_arns
}

output "connect_instance_id" { value = module.support.connect_instance_id }
