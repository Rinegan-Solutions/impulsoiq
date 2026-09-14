# One JSON secret per environment. Keys are packed here so we do not pay
# for (or rotate) a secret per vendor. Terraform creates the container;
# operators put values in. Terraform never writes a secret version.
#
# Until a version exists, GetSecretValue fails with ResourceNotFoundException
# for staging label AWSCURRENT. Readers (impulsoiq_secrets / Lambda secrets.ts)
# treat that as empty keys, not a crash.

resource "aws_secretsmanager_secret" "app" {
  name        = "${var.project}/${var.env}/app"
  description = "JSON keys: stripe_secret_key, stripe_webhook_secret, calle_api_key, dnc_api_key, enrichment_api_key, email_verification_api_key"
  tags        = var.tags
}

variable "project" { type = string }
variable "env" { type = string }
variable "tags" { type = map(string) }

output "app_secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "app_secret_name" {
  value = aws_secretsmanager_secret.app.name
}
