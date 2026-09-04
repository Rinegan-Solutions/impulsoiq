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
  description = "CRM Write Service Lambda ARN — used by the tenant-provisioner trigger"
}

# Where Cognito is allowed to send the browser after login/logout.
#
# This is a LIST because prod serves both the apex and www, and both must be
# registered or a user who arrived via www is redirected to a URL Cognito
# rejects. It is passed in rather than hardcoded so each environment points at
# its own host -- the previous hardcoded prod URL meant dev and test users were
# redirected into PRODUCTION after signing in.
variable "web_base_urls" {
  type        = list(string)
  description = "Base URLs of the web app for this environment, e.g. [\"https://impulsoiq.rinegansolutions.com\"]"

  validation {
    condition     = length(var.web_base_urls) > 0
    error_message = "web_base_urls must contain at least one URL."
  }
}
