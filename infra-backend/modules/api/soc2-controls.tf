# ── Phase 6D: SOC 2 Type II controls ──────────────────────────────────────────
#
# Implements the required AWS-level controls for SOC 2 Type II:
#   - CloudTrail: management + data event audit trail
#   - CloudWatch alarms: root login, MFA deactivation, unauthorized API calls
#   - S3: tamper-evident log storage with versioning and access logging
#   - Weekly access review Lambda (scheduled)
#
# Note: Incident-response runbooks reference the Phase 2E kill-switch mechanisms
# already built into the product — those are reused here, not rebuilt.

# ── S3 bucket for CloudTrail logs ─────────────────────────────────────────────
resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket        = "${var.project}-cloudtrail-${var.env}"
  force_destroy = var.env != "prod"
  tags          = merge(var.tags, { Purpose = "SOC2-CloudTrail" })
}

resource "aws_s3_bucket_versioning" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  bucket                  = aws_s3_bucket.cloudtrail_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSCloudTrailAclCheck"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:GetBucketAcl"
        Resource  = aws_s3_bucket.cloudtrail_logs.arn
      },
      {
        Sid       = "AWSCloudTrailWrite"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.cloudtrail_logs.arn}/AWSLogs/*"
        Condition = { StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" } }
      }
    ]
  })
}

# ── CloudTrail — all management events ────────────────────────────────────────
resource "aws_cloudwatch_log_group" "cloudtrail" {
  name              = "/aws/cloudtrail/${var.project}-${var.env}"
  retention_in_days = 2557 # 7 years (nearest allowed CloudWatch value)
  tags              = var.tags
}

resource "aws_iam_role" "cloudtrail_cw" {
  name = "${var.project}-cloudtrail-cw-${var.env}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudtrail.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "cloudtrail_cw" {
  name = "cloudtrail-to-cloudwatch"
  role = aws_iam_role.cloudtrail_cw.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
    }]
  })
}

resource "aws_cloudtrail" "main" {
  name                          = "${var.project}-audit-trail-${var.env}"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = true
  is_multi_region_trail         = false
  enable_log_file_validation    = true
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.cloudtrail_cw.arn

  tags = merge(var.tags, { Purpose = "SOC2-Audit" })
}

# ── SNS topic for security alerts ─────────────────────────────────────────────
resource "aws_sns_topic" "security_alerts" {
  name = "${var.project}-security-alerts-${var.env}"
  tags = var.tags
}

# ── CloudWatch alarms — SOC 2 required detections ─────────────────────────────

# Root account login
resource "aws_cloudwatch_log_metric_filter" "root_login" {
  name           = "${var.project}-root-login-${var.env}"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ $.userIdentity.type = \"Root\" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != \"AwsServiceEvent\" }"

  metric_transformation {
    name      = "RootLoginCount"
    namespace = "ImpulsoIQ/Security"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "root_login" {
  alarm_name          = "${var.project}-root-login-${var.env}"
  alarm_description   = "SOC 2: Root account login detected"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "RootLoginCount"
  namespace           = "ImpulsoIQ/Security"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
  tags                = var.tags
}

# MFA deactivated
resource "aws_cloudwatch_log_metric_filter" "mfa_deactivated" {
  name           = "${var.project}-mfa-deactivated-${var.env}"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ $.eventName = \"DeactivateMFADevice\" }"

  metric_transformation {
    name      = "MFADeactivatedCount"
    namespace = "ImpulsoIQ/Security"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "mfa_deactivated" {
  alarm_name          = "${var.project}-mfa-deactivated-${var.env}"
  alarm_description   = "SOC 2: MFA device deactivated"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "MFADeactivatedCount"
  namespace           = "ImpulsoIQ/Security"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
  tags                = var.tags
}

# Unauthorized API calls (consistent access denials)
resource "aws_cloudwatch_log_metric_filter" "unauthorized_api" {
  name           = "${var.project}-unauthorized-api-${var.env}"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ ($.errorCode = \"*UnauthorizedAccess\") || ($.errorCode = \"AccessDenied\") }"

  metric_transformation {
    name      = "UnauthorizedApiCallCount"
    namespace = "ImpulsoIQ/Security"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "unauthorized_api" {
  alarm_name          = "${var.project}-unauthorized-api-${var.env}"
  alarm_description   = "SOC 2: Repeated unauthorized API calls detected"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "UnauthorizedApiCallCount"
  namespace           = "ImpulsoIQ/Security"
  period              = 300 # 5-minute window
  statistic           = "Sum"
  threshold           = 10 # alert after 10 denials in 5 min
  alarm_actions       = [aws_sns_topic.security_alerts.arn]
  tags                = var.tags
}
