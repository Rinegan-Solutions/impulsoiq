# ── Inbound mail for the public contact addresses ────────────────────────────
#
# sales@, support@, privacy@ and legal@<mail_domain>:
#
#   MX (infra-web, prod) → SES receiving in this region
#     → receipt rule (only the listed addresses; anything else is rejected)
#       1. store the raw message in S3            (audit copy, always)
#       2. invoke contact-forwarder asynchronously (only if forward_to is set)
#
# WHY THIS MODULE IS PROD-ONLY
# SES allows ONE active receipt rule set per account per region. dev, test and
# prod share the account, so only one stack may own it; the root module
# instantiates this with count = prod.
#
# NO NEW SES IDENTITY
# Receipt rules apply to verified identities and their subdomains, and
# rinegansolutions.com is already verified in this region (see api/ses.tf).
# Creating an impulsoiq.rinegansolutions.com identity would also take precedence
# over the parent's DKIM settings for outbound mail, which is not wanted.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region     = data.aws_region.current.region
  account_id = data.aws_caller_identity.current.account_id

  rule_set_name = "${var.project}-inbound"
  rule_name     = "contact-addresses"
  # Built from names, not resource attributes, so the bucket policy and Lambda
  # permission can reference the rule before it exists (SES checks both when
  # the rule is created).
  rule_arn = "arn:aws:ses:${local.region}:${local.account_id}:receipt-rule-set/${local.rule_set_name}:receipt-rule/${local.rule_name}"

  recipients    = [for part in var.contact_local_parts : "${part}@${var.mail_domain}"]
  object_prefix = "inbound/"
  from_address  = "noreply@${var.mail_domain}"
  forwarding    = length(var.forward_to) > 0
  function_name = "${var.project}-contact-forwarder-${var.env}"
}

# ── Raw message store ────────────────────────────────────────────────────────

resource "aws_s3_bucket" "inbound" {
  bucket        = "${var.project}-inbound-mail-${var.env}"
  force_destroy = false
  tags          = merge(var.tags, { Purpose = "InboundContactMail" })
}

resource "aws_s3_bucket_public_access_block" "inbound" {
  bucket                  = aws_s3_bucket.inbound.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "inbound" {
  bucket = aws_s3_bucket.inbound.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Enquiries contain personal data; keep them no longer than needed.
resource "aws_s3_bucket_lifecycle_configuration" "inbound" {
  bucket = aws_s3_bucket.inbound.id
  rule {
    id     = "expire-received-mail"
    status = "Enabled"
    filter {
      prefix = local.object_prefix
    }
    expiration {
      days = var.retention_days
    }
  }
}

# The bucket policy from the SES receiving guide, scoped to this account and
# this one receipt rule.
resource "aws_s3_bucket_policy" "inbound" {
  bucket = aws_s3_bucket.inbound.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPuts"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.inbound.arn}/${local.object_prefix}*"
      Condition = {
        StringEquals = {
          "AWS:SourceAccount" = local.account_id
          "AWS:SourceArn"     = local.rule_arn
        }
      }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.inbound]
}

# ── Forwarder ────────────────────────────────────────────────────────────────

resource "aws_iam_role" "forwarder" {
  name = local.function_name
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "forwarder" {
  name = "contact-forwarder"
  role = aws_iam_role.forwarder.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/${local.function_name}*"
      },
      {
        Sid      = "ReadReceivedMail"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.inbound.arn}/${local.object_prefix}*"
      },
      {
        # The From address inherits verification from the parent domain
        # identity; the subdomain ARN is listed too so an explicit subdomain
        # identity added later does not silently break forwarding.
        Sid    = "SendForwardedMail"
        Effect = "Allow"
        Action = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = [
          "arn:aws:ses:${local.region}:${local.account_id}:identity/rinegansolutions.com",
          "arn:aws:ses:${local.region}:${local.account_id}:identity/${var.mail_domain}",
        ]
      },
    ]
  })
}

resource "aws_lambda_function" "forwarder" {
  function_name = local.function_name
  role          = aws_iam_role.forwarder.arn
  handler       = "handler.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  timeout       = 60
  memory_size   = 256

  filename         = "${path.module}/../lambda/codes/contact-forwarder/dist.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambda/codes/contact-forwarder/dist.zip")

  environment {
    variables = {
      MAIL_BUCKET  = aws_s3_bucket.inbound.bucket
      MAIL_PREFIX  = local.object_prefix
      MAIL_DOMAIN  = var.mail_domain
      FORWARD_FROM = local.from_address
      FORWARD_TO   = join(",", var.forward_to)
    }
  }

  tags = var.tags
}

resource "aws_lambda_permission" "ses_invoke" {
  statement_id   = "AllowSESInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.forwarder.function_name
  principal      = "ses.amazonaws.com"
  source_account = local.account_id
  source_arn     = local.rule_arn
}

# ── Receipt rules ────────────────────────────────────────────────────────────

resource "aws_ses_receipt_rule_set" "inbound" {
  rule_set_name = local.rule_set_name
}

resource "aws_ses_receipt_rule" "contact" {
  name          = local.rule_name
  rule_set_name = aws_ses_receipt_rule_set.inbound.rule_set_name
  recipients    = local.recipients
  enabled       = true
  # Verdicts are passed to the forwarder, which drops spam and malware.
  scan_enabled = true
  tls_policy   = "Optional"

  s3_action {
    bucket_name       = aws_s3_bucket.inbound.bucket
    object_key_prefix = local.object_prefix
    position          = 1
  }

  dynamic "lambda_action" {
    for_each = local.forwarding ? [1] : []
    content {
      function_arn    = aws_lambda_function.forwarder.arn
      invocation_type = "Event"
      position        = 2
    }
  }

  # SES verifies it can write to the bucket and invoke the function when the
  # rule is created, so both grants must exist first.
  depends_on = [aws_s3_bucket_policy.inbound, aws_lambda_permission.ses_invoke]
}

resource "aws_ses_active_receipt_rule_set" "inbound" {
  rule_set_name = aws_ses_receipt_rule_set.inbound.rule_set_name
  depends_on    = [aws_ses_receipt_rule.contact]
}
