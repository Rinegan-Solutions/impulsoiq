# ── EventBridge Scheduler — Phase 3 recurring agent triggers ─────────────────
#
# Forecasting agent: daily at 07:00 UTC (before business day starts)
# Data Hygiene agent: weekly on Sunday at 06:00 UTC
# Evaluations runner: daily at 08:00 UTC (after forecasting completes)
#
# All schedules use a ±15-minute flexible window to spread Lambda cold starts.

resource "aws_iam_role" "scheduler" {
  name = "${var.project}-scheduler-${var.env}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "scheduler" {
  name = "scheduler-invoke-policy"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "InvokeAgents"
      Effect = "Allow"
      Action = "lambda:InvokeFunction"
      Resource = [
        var.forecasting_agent_lambda_arn,
        var.hygiene_agent_lambda_arn,
        var.evaluations_runner_lambda_arn,
      ]
    }]
  })
}

# ── Forecasting agent — daily 07:00 UTC ───────────────────────────────────────
resource "aws_scheduler_schedule" "forecasting_daily" {
  name        = "${var.project}-forecasting-daily-${var.env}"
  group_name  = "default"
  description = "Run Forecasting & Insight Agent daily for all active tenants"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 15
  }

  schedule_expression          = "cron(0 7 * * ? *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = var.forecasting_agent_lambda_arn
    role_arn = aws_iam_role.scheduler.arn

    input = jsonencode({
      tenantId   = "__ALL__"
      reportType = "pipeline_forecast"
    })

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}

# ── Data Hygiene agent — weekly Sunday 06:00 UTC ─────────────────────────────
resource "aws_scheduler_schedule" "hygiene_weekly" {
  name        = "${var.project}-hygiene-weekly-${var.env}"
  group_name  = "default"
  description = "Run Data Hygiene Agent weekly to surface duplicate + decayed records"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 15
  }

  schedule_expression          = "cron(0 6 ? * SUN *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = var.hygiene_agent_lambda_arn
    role_arn = aws_iam_role.scheduler.arn

    input = jsonencode({
      tenantId = "__ALL__"
    })

    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 7200
    }
  }
}

# ── Evaluations runner — daily 08:00 UTC ─────────────────────────────────────
resource "aws_scheduler_schedule" "evaluations_daily" {
  name        = "${var.project}-evaluations-daily-${var.env}"
  group_name  = "default"
  description = "Run LLM-as-judge quality evaluations on recent agent runs"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 15
  }

  schedule_expression          = "cron(0 8 * * ? *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = var.evaluations_runner_lambda_arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}

# ── Signal Listening Agent — hourly (Phase 4C) ────────────────────────────────
# Gated: per v3, cannot run until Phase 3C metering is live.
# The agent itself checks budget synchronously before each synthesis run.
# Default: disabled on first deploy (enabled = false) — legal review required first.

resource "aws_scheduler_schedule" "signal_listening_hourly" {
  name        = "${var.project}-signal-listening-${var.env}"
  group_name  = "default"
  description = "Hourly signal monitoring for new candidate lead discovery"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 10
  }

  schedule_expression          = "rate(1 hour)"
  schedule_expression_timezone = "UTC"

  # Disabled by default — requires legal review per tenant per source
  # Set to "ENABLED" only after completing legal review checklist
  state = "DISABLED"

  target {
    arn      = var.signal_listening_lambda_arn
    role_arn = aws_iam_role.scheduler.arn

    input = jsonencode({
      tenantId = "__ALL__"
      dryRun   = false
    })

    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 1800
    }
  }
}

# ── SLA Monitor — every 5 minutes (Phase 7) ──────────────────────────────────
resource "aws_scheduler_schedule" "sla_monitor" {
  name        = "${var.project}-sla-monitor-${var.env}"
  group_name  = "default"
  description = "Detect and mark SLA breaches; auto-escalate tier"

  flexible_time_window { mode = "OFF" }

  schedule_expression          = "rate(5 minutes)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = var.sla_monitor_lambda_arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_retry_attempts       = 0 # no retry — next run in 5 min handles it
      maximum_event_age_in_seconds = 60
    }
  }
}

# ── Support Insight Agent — weekly Sunday 05:00 UTC (Phase 9) ────────────────
# Runs before the Forecasting Agent (07:00) so support signals are available
# when renewal-risk scoring runs. (v4 §9D dependency ordering)
resource "aws_scheduler_schedule" "support_insight_weekly" {
  name        = "${var.project}-support-insight-${var.env}"
  group_name  = "default"
  description = "Weekly support health metrics, KB gap detection, and CS loop signal refresh"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 15
  }

  schedule_expression          = "cron(0 5 ? * SUN *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = var.support_insight_lambda_arn
    role_arn = aws_iam_role.scheduler.arn

    input = jsonencode({
      tenantId   = "__ALL__"
      periodDays = 30
    })

    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 7200
    }
  }
}
