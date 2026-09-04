# ── Phase 6D: Enterprise SSO / SAML ──────────────────────────────────────────
#
# Adds SAML 2.0 SSO capability to the Cognito User Pool.
# Enterprise tenants configure their IdP (Okta, Azure AD, Google Workspace)
# via the Settings → Enterprise SSO UI; their SAML metadata is stored in
# Secrets Manager and used to create/update the Cognito identity provider.
#
# The identity provider resource is conditional — it only exists when
# var.saml_metadata_url is set for a given tenant. For the hackathon MVP,
# this is a stub that enterprise tenants will configure post-launch.

variable "saml_metadata_url" {
  type        = string
  default     = ""
  description = "SAML IdP metadata URL — set this for enterprise SSO tenants"
}

variable "saml_provider_name" {
  type        = string
  default     = "EnterpriseSSO"
  description = "Cognito identity provider name for the SAML IdP"
}

# Optional SAML identity provider — only created when metadata URL is provided
resource "aws_cognito_identity_provider" "saml" {
  count         = var.saml_metadata_url != "" ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = var.saml_provider_name
  provider_type = "SAML"

  provider_details = {
    MetadataURL             = var.saml_metadata_url
    IDPSignout              = "false"
    RequestSigningAlgorithm = "rsa-sha256"
  }

  attribute_mapping = {
    # Standard SAML → Cognito attribute mapping
    # Enterprise tenants customise this via their IdP
    email              = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
    name               = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
    "custom:tenant_id" = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/organizationunit"
  }
}

# Add SSO client to the user pool for enterprise tenants
resource "aws_cognito_user_pool_client" "enterprise_sso" {
  count        = var.saml_metadata_url != "" ? 1 : 0
  name         = "${var.project}-enterprise-sso-${var.env}"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  supported_identity_providers = [
    "COGNITO",
    var.saml_provider_name,
  ]

  # Derived per environment. Hardcoding the prod host here meant a dev or test
  # user completing SSO was handed off to the production app.
  callback_urls = [for u in var.web_base_urls : "${u}/auth/callback"]
  logout_urls   = [for u in var.web_base_urls : "${u}/sign-out"]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
}

# Secrets Manager: store the SAML metadata for audit and rotation
resource "aws_secretsmanager_secret" "saml_metadata" {
  count                   = var.saml_metadata_url != "" ? 1 : 0
  name                    = "${var.project}/sso/saml-metadata/${var.env}"
  recovery_window_in_days = var.env == "prod" ? 30 : 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "saml_metadata" {
  count     = var.saml_metadata_url != "" ? 1 : 0
  secret_id = aws_secretsmanager_secret.saml_metadata[0].id
  secret_string = jsonencode({
    metadataUrl  = var.saml_metadata_url
    providerName = var.saml_provider_name
    configuredAt = timestamp()
  })
}
