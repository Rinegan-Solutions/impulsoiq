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
