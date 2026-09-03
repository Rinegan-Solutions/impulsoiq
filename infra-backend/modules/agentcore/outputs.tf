# AgentCore outputs.
#
# aws_bedrockagentcore_agent_runtime exposes agent_runtime_arn / agent_runtime_id
# (there is no bare `.id`). Anything invoked as a target — Step Functions states,
# EventBridge Scheduler targets, Lambda invocations — needs the ARN.

output "gateway_endpoint" { value = aws_bedrockagentcore_gateway.main.gateway_url }
output "gateway_id" { value = aws_bedrockagentcore_gateway.main.gateway_id }
output "memory_store_id" { value = aws_bedrockagentcore_memory.main.id }
output "kms_key_arn" { value = aws_kms_key.agentcore.arn }

output "ecr_urls" {
  value = { for k, v in data.aws_ecr_repository.agent : k => v.repository_url }
}

# All runtime ARNs, keyed by agent name — convenient for wiring new targets
# without adding a named output every time.
output "agent_runtime_arns" {
  description = "Map of agent key → AgentCore runtime ARN"
  value       = { for k, v in aws_bedrockagentcore_agent_runtime.agent : k => v.agent_runtime_arn }
}

# ── Phase 1 ───────────────────────────────────────────────────────────────────
output "coordinator_runtime_id" {
  value = aws_bedrockagentcore_agent_runtime.agent["coordinator"].agent_runtime_id
}
output "clarification_runtime_id" {
  value = aws_bedrockagentcore_agent_runtime.agent["clarification"].agent_runtime_id
}

# ── Phase 2 (Step Functions targets) ──────────────────────────────────────────
output "research_enrichment_runtime_arn" {
  description = "AgentCore runtime ARN for research-enrichment (used by SFN)"
  value       = aws_bedrockagentcore_agent_runtime.agent["research-enrichment"].agent_runtime_arn
}
output "outreach_runtime_arn" {
  description = "AgentCore runtime ARN for outreach (used by SFN)"
  value       = aws_bedrockagentcore_agent_runtime.agent["outreach"].agent_runtime_arn
}
output "voice_runtime_arn" {
  description = "AgentCore runtime ARN for voice (used by SFN)"
  value       = aws_bedrockagentcore_agent_runtime.agent["voice"].agent_runtime_arn
}

# ── Phase 3 (scheduled) ───────────────────────────────────────────────────────
output "forecasting_insight_runtime_arn" {
  description = "Forecasting & Insight runtime ARN — daily scheduler target"
  value       = aws_bedrockagentcore_agent_runtime.agent["forecasting-insight"].agent_runtime_arn
}
output "data_hygiene_runtime_arn" {
  description = "Data Hygiene runtime ARN — weekly scheduler target"
  value       = aws_bedrockagentcore_agent_runtime.agent["data-hygiene"].agent_runtime_arn
}

# ── Phase 4 ───────────────────────────────────────────────────────────────────
output "ambient_interface_runtime_arn" {
  description = "Ambient Interface (Nova Sonic) runtime ARN — voice-bridge target"
  value       = aws_bedrockagentcore_agent_runtime.agent["ambient-interface"].agent_runtime_arn
}
output "deep_research_runtime_arn" {
  description = "Deep Research (Swarm) runtime ARN"
  value       = aws_bedrockagentcore_agent_runtime.agent["deep-research"].agent_runtime_arn
}
output "signal_listening_runtime_arn" {
  description = "Signal Listening runtime ARN — hourly scheduler target (disabled by default)"
  value       = aws_bedrockagentcore_agent_runtime.agent["signal-listening"].agent_runtime_arn
}

# ── Phase 7 ───────────────────────────────────────────────────────────────────
output "triage_escalation_runtime_arn" {
  description = "Triage & Escalation runtime ARN — invoked by connect-intake"
  value       = aws_bedrockagentcore_agent_runtime.agent["triage-escalation"].agent_runtime_arn
}

# ── Phase 8 ───────────────────────────────────────────────────────────────────
output "resolution_runtime_arn" {
  description = "Resolution Agent runtime ARN"
  value       = aws_bedrockagentcore_agent_runtime.agent["resolution"].agent_runtime_arn
}

# ── Phase 9 ───────────────────────────────────────────────────────────────────
output "support_insight_runtime_arn" {
  description = "Support Insight runtime ARN — weekly scheduler target"
  value       = aws_bedrockagentcore_agent_runtime.agent["support-insight"].agent_runtime_arn
}
