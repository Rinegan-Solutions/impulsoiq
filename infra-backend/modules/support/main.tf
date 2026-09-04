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

  # Contact flow: Lambda (Triage) -> set target queue -> transfer -> disconnect.
  #
  # The flow language is stricter than it looks, and CreateContactFlow reports
  # violations as an InvalidContactFlowException with an EMPTY message, so each
  # rule below is written out rather than inferred:
  #
  #  - Transitions uses NextAction / Errors / Conditions. There are no "Success"
  #    or "Error" keys; an Errors entry is {ErrorType, NextAction}.
  #  - Routing is two steps, not one. UpdateContactTargetQueue sets the target
  #    queue; TransferContactToQueue then moves the contact into whatever that
  #    target is and takes NO QueueId of its own. There is no "TransferToQueue".
  #  - UpdateContactTargetQueue's QueueId must be either fully static or a single
  #    JSONPath reference -- it cannot be interpolated or built from parts.
  #    $.External.* is where an InvokeLambdaFunction result lands.
  #  - A terminal action carries Transitions = {} and Parameters = {}.
  #  - InvocationTimeLimitSeconds is a STRING and Connect caps it at 8.
  #
  # To regenerate this by hand: build the flow in the Connect console and call
  # DescribeContactFlow -- that is what AWS recommends, and it emits exactly this
  # shape.
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
        }
        Transitions = {
          NextAction = "set-tier-queue"
          # If Triage fails or times out the call must still reach a human,
          # so every error path lands on the general queue rather than hanging up.
          Errors     = [{ ErrorType = "NoMatchingError", NextAction = "set-default-queue" }]
          Conditions = []
        }
      },
      {
        # queueId is returned by the connect-intake Lambda for the chosen tier.
        Identifier = "set-tier-queue"
        Type       = "UpdateContactTargetQueue"
        Parameters = { QueueId = "$.External.queueId" }
        Transitions = {
          NextAction = "transfer-to-queue"
          Errors     = [{ ErrorType = "NoMatchingError", NextAction = "set-default-queue" }]
          Conditions = []
        }
      },
      {
        Identifier = "set-default-queue"
        Type       = "UpdateContactTargetQueue"
        Parameters = { QueueId = aws_connect_queue.general.arn }
        Transitions = {
          NextAction = "transfer-to-queue"
          Errors     = [{ ErrorType = "NoMatchingError", NextAction = "disconnect" }]
          Conditions = []
        }
      },
      {
        Identifier = "transfer-to-queue"
        Type       = "TransferContactToQueue"
        Parameters = {}
        Transitions = {
          NextAction = "disconnect"
          Errors = [
            { ErrorType = "QueueAtCapacity", NextAction = "disconnect" },
            { ErrorType = "NoMatchingError", NextAction = "disconnect" },
          ]
          Conditions = []
        }
      },
      {
        Identifier  = "disconnect"
        Type        = "DisconnectParticipant"
        Parameters  = {}
        Transitions = {}
      },
    ]
  })

  tags = var.tags
}
