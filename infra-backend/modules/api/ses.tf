# ── SES domain identity and reputation monitoring ────────────────────────────
# Domain: impulsoiq.rinegansolutions.com
# SES configuration set tracks bounces and complaints. CloudWatch alarms
# fire when reputation thresholds are exceeded, triggering the send-pause-enforcer
# Lambda to halt outbound sending for 24 hours.

resource "aws_ses_domain_identity" "main" {
  domain = "impulsoiq.rinegansolutions.com"
}

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

resource "aws_ses_configuration_set" "main" {
  name = "impulsoiq-${var.env}"

  reputation_metrics_enabled = true
  sending_enabled            = true
}

# ── CloudWatch alarms for SES reputation ─────────────────────────────────────

resource "aws_sns_topic" "ses_reputation" {
  name = "${var.project}-ses-reputation-${var.env}"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "pause_enforcer" {
  topic_arn = aws_sns_topic.ses_reputation.arn
  protocol  = "lambda"
  endpoint  = var.send_pause_enforcer_arn
}

resource "aws_lambda_permission" "sns_invoke_pause_enforcer" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.send_pause_enforcer_arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.ses_reputation.arn
}

# Bounce rate alarm — CAN-SPAM threshold is 5%
resource "aws_cloudwatch_metric_alarm" "ses_bounce_rate" {
  alarm_name          = "${var.project}-ses-bounce-rate-${var.env}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Reputation.BounceRate"
  namespace           = "AWS/SES"
  period              = 300 # 5 minutes
  statistic           = "Average"
  threshold           = 0.05 # 5%
  alarm_description   = "SES bounce rate exceeded 5% — pausing outbound sends"
  alarm_actions       = [aws_sns_topic.ses_reputation.arn]
  ok_actions          = [aws_sns_topic.ses_reputation.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    ConfigurationSetName = aws_ses_configuration_set.main.name
  }

  tags = var.tags
}

# Complaint rate alarm — SES suspends at 0.1%
resource "aws_cloudwatch_metric_alarm" "ses_complaint_rate" {
  alarm_name          = "${var.project}-ses-complaint-rate-${var.env}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Reputation.ComplaintRate"
  namespace           = "AWS/SES"
  period              = 300 # 5 minutes
  statistic           = "Average"
  threshold           = 0.001 # 0.1%
  alarm_description   = "SES complaint rate exceeded 0.1% — pausing outbound sends"
  alarm_actions       = [aws_sns_topic.ses_reputation.arn]
  ok_actions          = [aws_sns_topic.ses_reputation.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    ConfigurationSetName = aws_ses_configuration_set.main.name
  }

  tags = var.tags
}
