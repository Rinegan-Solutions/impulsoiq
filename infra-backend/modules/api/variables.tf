variable "project" {
  type = string
}
variable "env" {
  type = string
}
variable "user_pool_arn" {
  type = string
}
variable "user_pool_id" {
  type    = string
  default = ""
}
variable "tags" {
  type = map(string)
}

variable "crm_write_service_arn" {
  type        = string
  default     = ""
  description = "ARN of the CRM Write Service Lambda"
}

variable "sequence_step_arn" {
  type        = string
  default     = ""
  description = "ARN of the sequence-step Lambda that advances campaign cadences"
}

variable "research_enrichment_agent_arn" {
  type        = string
  default     = ""
  description = "ARN of the research-enrichment AgentCore runtime Lambda/container"
}

variable "outreach_agent_arn" {
  type        = string
  default     = ""
  description = "ARN of the outreach AgentCore runtime Lambda/container"
}

variable "voice_agent_arn" {
  type        = string
  default     = ""
  description = "ARN of the voice AgentCore runtime Lambda/container"
}

variable "webhook_handler_arn" {
  type        = string
  default     = ""
  description = "ARN of the webhook-handler Lambda"
}

variable "send_pause_enforcer_arn" {
  type        = string
  default     = ""
  description = "ARN of the send-pause-enforcer Lambda"
}

variable "agents_event_bus_name" {
  type        = string
  default     = ""
  description = "Name of the agents EventBridge bus (owned by the data module)"
}


variable "nurture_trigger_lambda_arn" {
  type        = string
  default     = ""
  description = "ARN of the nurture-trigger Lambda — receives SES engagement events via SNS"
}

# Phase 3 scheduler targets
variable "forecasting_agent_runtime_arn" {
  type        = string
  default     = ""
  description = "ARN of the forecasting-insight agent Lambda wrapper (scheduled daily)"
}

variable "hygiene_agent_runtime_arn" {
  type        = string
  default     = ""
  description = "ARN of the data-hygiene agent Lambda wrapper (scheduled weekly)"
}

variable "evaluations_runner_lambda_arn" {
  type        = string
  default     = ""
  description = "ARN of the evaluations-runner Lambda (scheduled daily)"
}

# Phase 4
variable "voice_bridge_lambda_arn" {
  type        = string
  default     = ""
  description = "ARN of the voice-bridge Lambda — WebSocket handler for Nova Sonic"
}

# Phase 4C
variable "signal_listening_runtime_arn" {
  type        = string
  default     = ""
  description = "ARN of the Signal Listening Agent runtime (hourly scheduler target)"
}

# Phase 7
variable "sla_monitor_lambda_arn" {
  type        = string
  default     = ""
  description = "ARN of the sla-monitor Lambda (5-minute schedule)"
}

# Phase 9
variable "support_insight_runtime_arn" {
  type        = string
  default     = ""
  description = "ARN of the Support Insight Agent runtime (weekly scheduler target)"
}

# The agent-invoker Lambda. EventBridge Scheduler cannot target a
# bedrock-agentcore runtime, so every scheduled agent run goes through this
# shim with the agent's ARN in the payload.
variable "agent_invoker_lambda_arn" {
  type        = string
  description = "ARN of the agent-invoker Lambda that calls AgentCore InvokeAgentRuntime"
}

# Every Lambda ARN, keyed by function name. rest-api.tf looks up the eight
# HTTP-facing functions here rather than taking eight separate variables.
variable "lambda_function_arns" {
  type        = map(string)
  description = "Map of function name -> ARN, from module.lambda.function_arns"
}
