variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "contact_forward_to" {
  type        = list(string)
  description = "Inboxes that receive mail sent to sales@, support@, privacy@ and legal@impulsoiq.rinegansolutions.com (prod only). Empty = messages are stored in S3 only."
  default     = []
}

variable "env" {
  type        = string
  description = "dev | staging | prod"
}

# Stripe Price IDs (Dashboard). Empty = checkout fails closed.
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
