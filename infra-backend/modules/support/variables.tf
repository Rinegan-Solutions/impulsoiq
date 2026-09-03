variable "project" {
  type = string
}

variable "env" {
  type = string
}

variable "tags" {
  type = map(string)
}

variable "connect_intake_lambda_arn" {
  type        = string
  description = "connect-intake Lambda ARN — invoked by the inbound contact flow"
}
