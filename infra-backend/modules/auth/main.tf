# ─── Cognito User Pool ───────────────────────────────────────────────────────

resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-${var.env}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 12
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  schema {
    name                = "tenant_id"
    attribute_data_type = "String"
    mutable             = false
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 128
    }
  }

  # Display name for a workspace created at sign-up. tenant-provisioner copies it
  # into tenant.name when (and only when) it creates the workspace; before this
  # attribute existed the name typed at sign-up was discarded and every
  # workspace was named after its slug.
  #
  # ADDITIVE ONLY: Cognito allows custom attributes to be added to an existing
  # pool but never modified or removed, and the provider applies an added schema
  # block in place. Check the plan reads "update in-place" for the pool.
  schema {
    name                = "workspace_name"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 80
    }
  }

  # One function, two triggers (it switches on triggerSource):
  #   pre_sign_up       refuses an invalid/reserved workspace address, or an
  #                     existing workspace the email's domain may not join
  #   post_confirmation creates the workspace, or adds the verified member
  lambda_config {
    pre_sign_up       = aws_lambda_function.tenant_provisioner.arn
    post_confirmation = aws_lambda_function.tenant_provisioner.arn
  }

  tags = var.tags
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project}-web-${var.env}"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
}

# ─── RBAC groups ──────────────────────────────────────────────────────────────
# Group precedence controls which group's role is used for identity pool federation.
# Lower number = higher precedence.

resource "aws_cognito_user_group" "admin" {
  user_pool_id = aws_cognito_user_pool.main.id
  name         = "admin"
  description  = "Full workspace access — configure campaigns, manage team, view all data"
  precedence   = 1
}

resource "aws_cognito_user_group" "manager" {
  user_pool_id = aws_cognito_user_pool.main.id
  name         = "manager"
  description  = "Run campaigns, view reports, manage contacts/deals"
  precedence   = 5
}

resource "aws_cognito_user_group" "member" {
  user_pool_id = aws_cognito_user_pool.main.id
  name         = "member"
  description  = "View and execute own assigned campaigns"
  precedence   = 10
}

# ─── Tenant Provisioner Lambda ────────────────────────────────────────────────

resource "aws_iam_role" "tenant_provisioner" {
  name = "${var.project}-tenant-provisioner-${var.env}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "tenant_provisioner" {
  name = "tenant-provisioner-policy"
  role = aws_iam_role.tenant_provisioner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Sid      = "InvokeCrmWrite"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.crm_write_service_arn
      },
      {
        Sid      = "InvokeCrmRead"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.crm_read_service_arn
      },
      {
        # AdminDisableUser: an account that confirmed into a workspace it may not
        # join (someone else created it after sign-up) is disabled rather than
        # left holding that workspace's claim.
        Sid    = "CognitoMembership"
        Effect = "Allow"
        # AdminListGroupsForUser: an account that already holds a role needs no
        # invitation and must not be disabled -- see hasWorkspaceGroup().
        Action = [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminDisableUser",
          "cognito-idp:AdminListGroupsForUser",
        ]
        Resource = aws_cognito_user_pool.main.arn
      }
    ]
  })
}

resource "aws_lambda_function" "tenant_provisioner" {
  function_name = "${var.project}-tenant-provisioner-${var.env}"
  role          = aws_iam_role.tenant_provisioner.arn
  handler       = "handler.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  timeout       = 15
  memory_size   = 128

  filename         = "${path.module}/../lambda/codes/tenant-provisioner/dist.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambda/codes/tenant-provisioner/dist.zip")

  environment {
    variables = {
      CRM_WRITE_SERVICE_ARN = var.crm_write_service_arn
      CRM_READ_SERVICE_ARN  = var.crm_read_service_arn
      ENV                   = var.env
    }
  }

  tags = var.tags
}

# Allow Cognito to invoke the post-confirmation Lambda
resource "aws_lambda_permission" "cognito_post_confirmation" {
  statement_id  = "AllowCognitoPostConfirmation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tenant_provisioner.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
