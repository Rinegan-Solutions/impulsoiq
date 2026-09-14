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

variable "receive_mail" {
  type        = bool
  description = "Publish the MX record that routes mail for this FQDN to SES receiving. Prod only: the receipt rule set is account-wide."
  default     = false
}

variable "tenant_subdomains" {
  type        = bool
  description = <<-EOT
    Serve per-tenant addresses at <slug>.<fqdn>.

    Turning this on adds three things that only make sense together: a wildcard
    SAN on the certificate, a wildcard A/AAAA record, and the CloudFront
    function that resolves the host label to a tenant slug. It is a variable
    rather than always-on so a non-prod environment can be brought up without
    waiting on wildcard certificate validation.
  EOT
  default     = true
}
