# Partial backend configuration — real values come from the per-environment
# backend.hcl file, selected by ENV in the CodeBuild project.
#
# Local usage:
#   terraform init -backend-config="environments/dev/backend.hcl"
#   terraform plan  -var-file="environments/dev/terraform.tfvars"
#
# CI usage (infra-web/buildspec-*.yml):
#   terraform init -backend-config="environments/${ENV}/backend.hcl"
terraform {
  backend "s3" {}
}
