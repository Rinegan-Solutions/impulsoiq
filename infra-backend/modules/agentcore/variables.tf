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
  description = <<-EOT
    Speech-to-speech model for the Ambient Interface Agent.

    Nova Sonic is not offered in eu-west-2 -- `aws bedrock
    list-foundation-models --region eu-west-2` returns no sonic model — so this
    must name a cross-region endpoint to enable spoken interaction, and the
    agent falls back to its text path when it cannot reach one. Left empty by
    default so the capability is switched on deliberately rather than failing
    silently in a region that cannot serve it.
  EOT
  default     = ""
}
