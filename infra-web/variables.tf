variable "aws_region" {
  type        = string
  description = "Deployment region. ACM certs for CloudFront are handled by the us_east_1 provider alias."
  default     = "eu-west-2"
}

variable "env" {
  type        = string
  description = "dev | test | prod"

  validation {
    condition     = contains(["dev", "test", "prod"], var.env)
    error_message = "env must be one of: dev, test, prod."
  }
}

variable "subdomain" {
  type        = string
  description = <<-EOT
    Host label under route53_zone_name. An EMPTY STRING means serve at the zone
    apex, which is what prod does: users go to impulsoiq.rinegansolutions.com,
    not app.impulsoiq.rinegansolutions.com. Non-prod uses "dev" / "test".
  EOT
  default     = ""
}

variable "www_alias" {
  type        = bool
  description = <<-EOT
    Also serve www.<fqdn> from the same distribution and certificate. Intended
    for prod at the apex; www.dev.impulsoiq... has no audience.
  EOT
  default     = false
}

variable "route53_zone_name" {
  type        = string
  description = "Hosted zone that serves the app FQDNs. Created once as a bootstrap resource and shared by dev/test/prod; Terraform only reads it."
  default     = "impulsoiq.rinegansolutions.com"
}
