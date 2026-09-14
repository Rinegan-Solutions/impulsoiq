variable "project" {
  type = string
}

variable "env" {
  type = string
}

variable "tags" {
  type = map(string)
}

variable "mail_domain" {
  type        = string
  description = "Domain the contact addresses live on. Must be a verified SES identity or a subdomain of one."
}

variable "contact_local_parts" {
  type        = list(string)
  description = "Local parts accepted at mail_domain. Mail to any other address on the domain is rejected by SES."
  default     = ["sales", "support", "privacy", "legal"]
}

variable "forward_to" {
  type        = list(string)
  description = "Inboxes that receive a copy of every accepted message. Empty = store in S3 only."
  default     = []

  validation {
    condition     = alltrue([for a in var.forward_to : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", a))])
    error_message = "forward_to must contain only email addresses."
  }
}

variable "retention_days" {
  type        = number
  description = "Days the raw copy of each received message is kept in S3."
  default     = 365
}
