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
