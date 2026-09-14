variable "project" {
  type = string
}
variable "env" {
  type = string
}
variable "tags" {
  type = map(string)
}
variable "crm_write_service_arn" {
  type        = string
  description = "ARN of the CRM Write Service Lambda"
}

variable "crm_read_service_arn" {
  type        = string
  default     = ""
  description = "ARN of the CRM Read Service Lambda"
}

variable "dynamodb_table" {
  type        = string
  default     = ""
  description = "DynamoDB single-table event store name"
}

variable "app_secret_arn" {
  type        = string
  description = "Packed JSON app secret ARN"
}

variable "agents_event_bus_arn" {
  type        = string
  default     = ""
  description = "ARN of the agents EventBridge bus"
}

variable "calle_base_url" {
  type        = string
  default     = ""
  description = "CALL-E API base URL"
}

variable "calle_webhook_url" {
  type        = string
  default     = ""
  description = "Webhook URL that CALL-E will POST CallCompleted events to"
}

variable "allow_voice_stub" {
  type        = string
  default     = "false"
  description = "When true and ENV is not prod, VoiceProvider may stub CALL-E. Always false in prod."
}

variable "dnc_api_url" {
  type        = string
  default     = ""
  description = "DNC scrubber API base URL. Empty means fail-closed except DNC_TEST_NUMBERS."
}

variable "dnc_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "DNC scrubber API key"
}

variable "dnc_test_numbers" {
  type        = string
  default     = ""
  description = "Comma-separated E.164 numbers allowed when no DNC provider is configured (internal tests only)."
}

variable "enrichment_api_url" {
  type        = string
  default     = ""
  description = "External contact enrichment API endpoint"
}

variable "enrichment_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "API key for the external enrichment provider"
}

# Phase 2A v3: email verification API (Hunter.io/ZeroBounce-class)
variable "email_verification_api_url" {
  type        = string
  default     = ""
  description = "Email verification API endpoint (e.g. Hunter.io, ZeroBounce)"
}

variable "email_verification_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "API key for the email verification provider"
}

# Phase 3
variable "reporting_table" {
  type        = string
  default     = ""
  description = "DynamoDB reporting table name (forecasts, quality scores)"
}

variable "metering_table" {
  type        = string
  default     = ""
  description = "DynamoDB metering table name (usage counters)"
}

variable "ambient_voice_model" {
  type        = string
  description = "Speech-to-speech model for the Ambient Interface Agent."
  default     = "amazon.nova-2-sonic-v1:0"
}

variable "ambient_voice_region" {
  type        = string
  description = <<-EOT
    Region the speech-to-speech model is invoked in.

    Nova Sonic is published in NO EU region -- eu-west-2, eu-west-1 and
    eu-central-1 all return no sonic model, so this cannot be eu-west-1. It is
    available in us-east-1 (nova-2-sonic and nova-sonic), us-west-2 and
    ap-northeast-1.

    This is a data-residency decision, not just a latency one: enabling voice
    sends EU end-users' audio to the named region, which the GDPR position in
    PRD §12 has to account for. Only the ambient VOICE path uses it -- every
    other agent, and this agent's own text path, stay in eu-west-2.
  EOT
  default     = "us-east-1"
}

variable "reasoning_effort" {
  type        = string
  description = <<-EOT
    Nova 2 extended-thinking level: low | medium | high.

    medium is the roster default in both implementation plans. Note high is not
    a drop-in swap -- Nova 2 rejects maxTokens, temperature, topP and topK when
    maxReasoningEffort is high, so raising this needs the inference config
    reviewed alongside it.
  EOT
  default     = "medium"

  validation {
    condition     = contains(["low", "medium", "high"], var.reasoning_effort)
    error_message = "reasoning_effort must be low, medium or high."
  }
}
