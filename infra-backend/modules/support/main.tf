# ── Amazon Connect — Phase 7 (v4 §7A) ────────────────────────────────────────
#
# Connect is the inbound telephony and omnichannel routing backbone.
# CALL-E remains the platform for ALL outbound calls (Phase 2E onwards).
#
# What Connect is used for here:
#   - Phone number provisioning and inbound call handling
#   - IVR-equivalent contact flows (Lambda step invokes Triage agent)
#   - Queueing and skill/capacity-based routing execution
#   - Native chat channel transport
#   - Contact Lens transcription and sentiment (consumed as data source)
#
# ImpulsoIQ's Triage & Escalation Agent is the reasoning layer.
# Q in Connect and Connect's native AI agents are NOT used for decisions —
# that would put classification outside the Control Panel governance.

resource "aws_connect_instance" "main" {
  identity_management_type = "CONNECT_MANAGED"
  inbound_calls_enabled    = true
  outbound_calls_enabled   = false # outbound stays with CALL-E

  # Contact Lens: transcription + sentiment (consumed as data, not reasoning)
  auto_resolve_best_voices_enabled = false
  contact_flow_logs_enabled        = true
  contact_lens_enabled             = true
  early_media_enabled              = true
  multi_party_conference_enabled   = false

  instance_alias = "${var.project}-support-${var.env}"
  tags           = var.tags
}

# ── Hours of operation ────────────────────────────────────────────────────────
resource "aws_connect_hours_of_operation" "business_hours" {
  instance_id = aws_connect_instance.main.id
  name        = "${var.project}-business-hours-${var.env}"
  description = "Standard support hours (EU-west-2 / GMT timezone)"
  time_zone   = "Europe/London"

  config {
    day = "MONDAY"
    start_time {
      hours   = 8
      minutes = 0
    }
    end_time {
      hours   = 18
      minutes = 0
    }
  }

  config {
    day = "TUESDAY"
    start_time {
      hours   = 8
      minutes = 0
    }
    end_time {
      hours   = 18
      minutes = 0
    }
  }

  config {
    day = "WEDNESDAY"
    start_time {
      hours   = 8
      minutes = 0
    }
    end_time {
      hours   = 18
      minutes = 0
    }
  }

  config {
    day = "THURSDAY"
    start_time {
      hours   = 8
      minutes = 0
    }
    end_time {
      hours   = 18
      minutes = 0
    }
  }

  config {
    day = "FRIDAY"
    start_time {
      hours   = 8
      minutes = 0
    }
    end_time {
      hours   = 17
      minutes = 0
    }
  }

  tags = var.tags
}

# ── Default queues ────────────────────────────────────────────────────────────
resource "aws_connect_queue" "general" {
  instance_id           = aws_connect_instance.main.id
  name                  = "${var.project}-general-${var.env}"
  description           = "General support queue (Tier 1-2)"
  hours_of_operation_id = aws_connect_hours_of_operation.business_hours.hours_of_operation_id
  tags                  = var.tags
}

resource "aws_connect_queue" "billing" {
  instance_id           = aws_connect_instance.main.id
  name                  = "${var.project}-billing-${var.env}"
  description           = "Billing and AR support queue"
  hours_of_operation_id = aws_connect_hours_of_operation.business_hours.hours_of_operation_id
  tags                  = var.tags
}

resource "aws_connect_queue" "escalations" {
  instance_id           = aws_connect_instance.main.id
  name                  = "${var.project}-escalations-${var.env}"
  description           = "Tier 3 hard-escalation queue (senior/manager only)"
  hours_of_operation_id = aws_connect_hours_of_operation.business_hours.hours_of_operation_id
  tags                  = var.tags
}

# ── Lambda integration permissions ───────────────────────────────────────────
resource "aws_lambda_permission" "connect_intake" {
  statement_id  = "AllowConnectInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.connect_intake_lambda_arn
  principal     = "connect.amazonaws.com"
  source_arn    = aws_connect_instance.main.arn
}

# ── Contact Flow — inbound voice ──────────────────────────────────────────────
# The contact flow invokes the connect-intake Lambda which runs Triage.
# Tier is returned as a Lambda attribute and used for queue routing.
resource "aws_connect_contact_flow" "inbound_voice" {
  instance_id = aws_connect_instance.main.id
  name        = "${var.project}-inbound-voice-${var.env}"
  description = "Inbound voice: invoke Triage agent, route by tier"
  type        = "CONTACT_FLOW"

  # Simplified contact flow: Lambda → tier attribute → queue routing
  content = jsonencode({
    Version     = "2019-10-30"
    StartAction = "invoke-triage"
    Actions = [
      {
        Identifier = "invoke-triage"
        Type       = "InvokeLambdaFunction"
        Parameters = {
          LambdaFunctionARN          = var.connect_intake_lambda_arn
          InvocationTimeLimitSeconds = "8"
          LambdaInvocationAttributes = {
            tenantId = "$.Attributes.tenantId"
          }
        }
        Transitions = {
          Success = "route-by-tier"
          Error   = "route-default"
        }
      },
      {
        Identifier = "route-by-tier"
        Type       = "TransferToQueue"
        Parameters = {
          QueueId = "$.External.queueId"
        }
        Transitions = {
          Success = "end"
          Error   = "route-default"
        }
      },
      {
        Identifier = "route-default"
        Type       = "TransferToQueue"
        Parameters = {
          QueueId = aws_connect_queue.general.queue_id
        }
        Transitions = { Success = "end" }
      },
      {
        Identifier = "end"
        Type       = "DisconnectParticipant"
      }
    ]
  })

  tags = var.tags
}
