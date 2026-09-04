# ── SES sending identity and reputation monitoring ───────────────────────────
# Sends from: noreply@impulsoiq.rinegansolutions.com
#
# WHY THERE IS NO aws_ses_domain_identity RESOURCE HERE
# rinegansolutions.com is already a verified SES identity in this account and
# region, with DKIM enabled and verified. SES treats a verified domain as
# covering every subdomain, so mail from impulsoiq.rinegansolutions.com is
# already authorised and DKIM-signed under the parent's keys — verifying the
# subdomain separately buys nothing.
#
# It would also actively cause harm: an SES identity is one account-level
# resource, so dev, test and prod would each claim ownership of it, and
# `terraform destroy` in any single environment would un-verify the domain for
# the other two. The parent identity is deliberately managed outside this
# stack.
#
# The data source below is an assertion, not a creation: if the parent identity
# is ever missing, plan fails here with a clear cause rather than every send
# failing at runtime.
data "aws_ses_domain_identity" "sending" {
  domain = "rinegansolutions.com"
}

# The configuration set IS per-environment and correctly owned here — it tracks
# bounces and complaints, and the CloudWatch alarms below fire the
# send-pause-enforcer Lambda to halt outbound sending for 24 hours.

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
