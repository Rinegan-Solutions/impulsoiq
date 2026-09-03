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
  description = "Subdomain prefix for the web app, e.g. 'app' or 'app-dev'."
}
