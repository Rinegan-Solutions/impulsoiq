variable "project" {
  type = string
}
variable "env" {
  type = string
}
variable "dsql_endpoint" {
  type        = string
  description = "Aurora DSQL cluster endpoint"
}
variable "dynamodb_table" {
  type        = string
  description = "DynamoDB single-table event store name"
}
variable "dynamodb_stream_arn" {
  type        = string
  default     = ""
  description = "DynamoDB Streams ARN for the events table — triggers appsync-publisher and metering-aggregator"
}
# appsync_url and state_machine_arn are NOT Terraform variables — they are
# read from SSM at Lambda cold start to avoid a lambda→api module cycle.
# SSM paths: /impulsoiq/{env}/backend/appsync_url
#             /impulsoiq/{env}/backend/state_machine_arn

# Phase 3: passed directly from data module (no cycle — lambda depends on data)
variable "metering_table" {
  type        = string
  default     = ""
  description = "DynamoDB metering table name for metering-aggregator and evaluations-runner"
}

variable "reporting_table" {
  type        = string
  default     = ""
  description = "DynamoDB reporting table name for evaluations-runner"
}

variable "tags" {
  type = map(string)
}

variable "calle_base_url" {
  type        = string
  default     = ""
  description = "CALL-E API base URL for best-effort in-flight cancel"
}

variable "app_secret_arn" {
  type        = string
  description = "Secrets Manager ARN for the packed JSON app secret"
}

variable "stripe_price_starter_monthly" {
  type    = string
  default = ""
}
variable "stripe_price_starter_annual" {
  type    = string
  default = ""
}
variable "stripe_price_growth_monthly" {
  type    = string
  default = ""
}
variable "stripe_price_growth_annual" {
  type    = string
  default = ""
}
variable "stripe_price_pack_call_minutes" {
  type    = string
  default = ""
}
variable "stripe_price_pack_enrichment" {
  type    = string
  default = ""
}
variable "stripe_price_pack_concurrent_runs" {
  type    = string
  default = ""
}

variable "web_host" {
  type        = string
  description = "Host the web app is served from for this environment. Workspaces live at <slug>.<web_host>, so invitation links are built from it."
}

variable "ses_from_address" {
  type        = string
  description = "From address for transactional mail (invitations). Must be on a verified SES identity."
  default     = "noreply@impulsoiq.rinegansolutions.com"
}
