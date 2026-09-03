# ── Nurture Agent engagement trigger ─────────────────────────────────────────
#
# Phase 2F: route SES engagement events (opens, clicks, replies) to the
# nurture-trigger Lambda, which checks cadence state and invokes the Nurture
# agent if re-engagement is warranted.
#
# Pattern: SES configuration set → SNS event destination → Lambda subscription
# (SES's Terraform resource supports SNS as an event destination; EventBridge
#  direct support requires the v2 SES resource — added in Phase 3 upgrade path).

resource "aws_sns_topic" "ses_engagement" {
  name = "${var.project}-ses-engagement-${var.env}"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "nurture_trigger" {
  topic_arn = aws_sns_topic.ses_engagement.arn
  protocol  = "lambda"
  endpoint  = var.nurture_trigger_lambda_arn
}

resource "aws_lambda_permission" "sns_invoke_nurture" {
  statement_id  = "AllowSNSNurtureTrigger"
  action        = "lambda:InvokeFunction"
  function_name = var.nurture_trigger_lambda_arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.ses_engagement.arn
}

# SNS event destination on the SES configuration set
resource "aws_ses_event_destination" "engagement" {
  name                   = "${var.project}-engagement-${var.env}"
  configuration_set_name = aws_ses_configuration_set.main.name
  enabled                = true
  matching_types         = ["open", "click", "bounce", "complaint", "delivery"]

  sns_destination {
    topic_arn = aws_sns_topic.ses_engagement.arn
  }
}

# IAM: allow SES to publish to the SNS topic
resource "aws_sns_topic_policy" "ses_engagement" {
  arn = aws_sns_topic.ses_engagement.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPublish"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.ses_engagement.arn
    }]
  })
}
