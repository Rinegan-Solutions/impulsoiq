# ── Step Functions — Campaign Execution Graph ─────────────────────────────────
#
# Phase 2 campaign execution state machine.
# Implements the full SDR lead-qualification + follow-up graph.
#
# Async voice calls: PlaceVoiceCall uses .waitForTaskToken — the execution
# pauses until the webhook-handler Lambda calls sfn:SendTaskSuccess after
# CALL-E completes the call.
#
# All Lambda invocations use arn:aws:states:::lambda:invoke resource.
# All task states include OCC_CONFLICT retry to handle DSQL optimistic
# concurrency control errors.

locals {
  sfn_retry = [
    {
      ErrorEquals     = ["OCC_CONFLICT", "Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException", "States.TaskFailed"]
      MaxAttempts     = 3
      IntervalSeconds = 2
      BackoffRate     = 2.0
    }
  ]
}

resource "aws_sfn_state_machine" "campaign" {
  name     = "${var.project}-campaign-${var.env}"
  role_arn = aws_iam_role.sfn.arn
  type     = "STANDARD"

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.sfn.arn}:*"
    include_execution_data = true
    level                  = "ALL"
  }

  definition = jsonencode({
    Comment = "ImpulsoIQ Phase 2 campaign execution graph"
    StartAt = "LogRunStart"

    States = {

      # ── 1. Log run start ───────────────────────────────────────────────────
      LogRunStart = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.crm_write_service_arn
          Payload = {
            "operation" : "upsert_agent_run"
            "tenantId.$" : "$.tenantId"
            "actorType" : "agent"
            "actorId" : "sfn-campaign"
            "payload" = {
              "id.$" : "$.agentRunId"
              "contactId.$" : "$.contactId"
              "campaignId.$" : "$.campaignId"
              "agentType" : "coordinator"
              "status" : "running"
            }
          }
        }
        ResultPath = "$.logRunStartResult"
        Retry      = local.sfn_retry
        Next       = "EnrichContact"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 2. Enrich contact ──────────────────────────────────────────────────
      EnrichContact = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.research_enrichment_agent_arn
          Payload = {
            "tenantId.$" : "$.tenantId"
            "contactId.$" : "$.contactId"
            "campaignId.$" : "$.campaignId"
          }
        }
        ResultPath = "$.enrichmentResult"
        Retry      = local.sfn_retry
        Next       = "CheckEmailConsent"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 3. Check email consent ─────────────────────────────────────────────
      CheckEmailConsent = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.crm_write_service_arn
          Payload = {
            "operation" : "check_consent"
            "tenantId.$" : "$.tenantId"
            "actorType" : "agent"
            "actorId" : "sfn-campaign"
            "payload" = {
              "contactId.$" : "$.contactId"
              "channel" : "email"
            }
          }
        }
        ResultSelector = {
          "hasConsent.$" : "$.Payload.result.hasConsent"
        }
        ResultPath = "$.emailConsent"
        Retry      = local.sfn_retry
        Next       = "EmailConsentGate"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 4. Email consent gate ──────────────────────────────────────────────
      EmailConsentGate = {
        Type = "Choice"
        Choices = [{
          Variable      = "$.emailConsent.hasConsent"
          BooleanEquals = true
          Next          = "DraftEmail"
        }]
        Default = "CheckCallConsent"
      }

      # ── 5. Draft email ─────────────────────────────────────────────────────
      DraftEmail = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.outreach_agent_arn
          Payload = {
            "tenantId.$" : "$.tenantId"
            "contactId.$" : "$.contactId"
            "campaignId.$" : "$.campaignId"
            "channel" : "email"
            "hasConsent" : true
            "approvalMode" : "human_in_loop"
          }
        }
        ResultPath = "$.draftEmailResult"
        Retry      = local.sfn_retry
        Next       = "EmailApprovalGate"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 6. Email approval gate ─────────────────────────────────────────────
      EmailApprovalGate = {
        Type = "Choice"
        Choices = [{
          Variable      = "$.campaignConfig.requiresApproval"
          BooleanEquals = true
          Next          = "WaitForEmailApproval"
        }]
        Default = "SendEmail"
      }

      # ── 7. Wait for email approval (human in the loop) ────────────────────
      WaitForEmailApproval = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke.waitForTaskToken"
        Parameters = {
          FunctionName = var.crm_write_service_arn
          Payload = {
            "operation" : "upsert_activity"
            "tenantId.$" : "$.tenantId"
            "actorType" : "agent"
            "actorId" : "sfn-campaign"
            "payload" = {
              "contactId.$" : "$.contactId"
              "type" : "email"
              "actorType" : "agent"
              "actorId" : "sfn-campaign"
              "body" : "Email draft awaiting human approval"
              "metadata" = {
                "status" : "awaiting_approval"
                "taskToken.$" : "$$.Task.Token"
              }
            }
          }
        }
        HeartbeatSeconds = 86400
        ResultPath       = "$.approvalResult"
        Retry            = local.sfn_retry
        Next             = "SendEmail"
        # States.ALL must be the ONLY entry in its catcher and the last catcher
        # in the list -- ASL rejects it alongside a named error. Listing
        # States.HeartbeatTimeout next to it was also redundant: States.ALL
        # already matches it, and both routed to HandleError with the same
        # ResultPath, so collapsing loses nothing.
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 8. Send email ──────────────────────────────────────────────────────
      SendEmail = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.outreach_agent_arn
          Payload = {
            "tenantId.$" : "$.tenantId"
            "contactId.$" : "$.contactId"
            "campaignId.$" : "$.campaignId"
            "channel" : "email"
            "hasConsent" : true
            "approvalMode" : "auto_send"
          }
        }
        ResultPath = "$.sendEmailResult"
        Retry      = local.sfn_retry
        Next       = "WaitForEngagement"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 9. Wait for engagement (48h) ───────────────────────────────────────
      WaitForEngagement = {
        Type    = "Wait"
        Seconds = 172800
        Next    = "CheckCallConsent"
      }

      # ── 10. Check call consent ─────────────────────────────────────────────
      CheckCallConsent = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.crm_write_service_arn
          Payload = {
            "operation" : "check_consent"
            "tenantId.$" : "$.tenantId"
            "actorType" : "agent"
            "actorId" : "sfn-campaign"
            "payload" = {
              "contactId.$" : "$.contactId"
              "channel" : "call"
            }
          }
        }
        ResultSelector = {
          "hasConsent.$" : "$.Payload.result.hasConsent"
        }
        ResultPath = "$.callConsent"
        Retry      = local.sfn_retry
        Next       = "CallConsentGate"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 11. Call consent gate ──────────────────────────────────────────────
      CallConsentGate = {
        Type = "Choice"
        Choices = [{
          Variable      = "$.callConsent.hasConsent"
          BooleanEquals = true
          Next          = "PlaceVoiceCall"
        }]
        Default = "LogCompletion"
      }

      # ── 12. Place voice call (async — waits for CALL-E webhook) ───────────
      PlaceVoiceCall = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke.waitForTaskToken"
        Parameters = {
          FunctionName = var.voice_agent_arn
          Payload = {
            "tenantId.$" : "$.tenantId"
            "contactId.$" : "$.contactId"
            "campaignId.$" : "$.campaignId"
            "agentRunId.$" : "$.agentRunId"
            "callGoal" : "qualification"
            "taskToken.$" : "$$.Task.Token"
            "idempotencyKey.$" : "$$.Execution.Name"
          }
        }
        HeartbeatSeconds = 86400
        ResultPath       = "$.callResult"
        Retry            = local.sfn_retry
        Next             = "ProcessCallResult"
        # Same ASL rule as the email approval gate above: States.ALL alone, last.
        # The named errors this replaces were States.HeartbeatTimeout (no
        # CALL-E webhook inside 24h) and CALL_FAILED (the voice provider
        # reporting a failed call). Both are already matched by States.ALL and
        # both routed here identically. Note neither is in local.sfn_retry, so
        # a failed call is not retried -- it goes straight to HandleError.
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 13. Process call result ────────────────────────────────────────────
      ProcessCallResult = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.crm_write_service_arn
          Payload = {
            "operation" : "upsert_call_result"
            "tenantId.$" : "$.tenantId"
            "actorType" : "agent"
            "actorId" : "sfn-campaign"
            "payload" = {
              "agentRunId.$" : "$.agentRunId"
              "contactId.$" : "$.contactId"
              "callId.$" : "$.callResult.callId"
              "idempotencyKey.$" : "$$.Execution.Name"
              "outcome.$" : "$.callResult.outcome"
              "durationSeconds.$" : "$.callResult.durationSeconds"
              "transcriptS3Key.$" : "$.callResult.transcriptS3Key"
              "summaryJson.$" : "$.callResult.summaryJson"
            }
          }
        }
        ResultPath = "$.callResultRecord"
        Retry      = local.sfn_retry
        Next       = "LogCompletion"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "HandleError"
          ResultPath  = "$.error"
        }]
      }

      # ── 14. Log completion ─────────────────────────────────────────────────
      LogCompletion = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.crm_write_service_arn
          Payload = {
            "operation" : "upsert_agent_run"
            "tenantId.$" : "$.tenantId"
            "actorType" : "agent"
            "actorId" : "sfn-campaign"
            "payload" = {
              "id.$" : "$.agentRunId"
              "contactId.$" : "$.contactId"
              "agentType" : "coordinator"
              "status" : "completed"
            }
          }
        }
        ResultPath = "$.logCompletionResult"
        Retry      = local.sfn_retry
        Next       = "CampaignSuccess"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "CampaignSuccess"
          ResultPath  = "$.logCompletionError"
        }]
      }

      # ── 15. Success ────────────────────────────────────────────────────────
      CampaignSuccess = {
        Type = "Succeed"
      }

      # ── 16. Error handler — catch-all ──────────────────────────────────────
      HandleError = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.crm_write_service_arn
          Payload = {
            "operation" : "upsert_agent_run"
            "tenantId.$" : "$.tenantId"
            "actorType" : "agent"
            "actorId" : "sfn-campaign"
            "payload" = {
              "id.$" : "$.agentRunId"
              "contactId.$" : "$.contactId"
              "agentType" : "coordinator"
              "status" : "failed"
              "error.$" : "States.JsonToString($.error)"
            }
          }
        }
        ResultPath = "$.handleErrorResult"
        Retry = [{
          ErrorEquals     = ["Lambda.ServiceException"]
          MaxAttempts     = 2
          IntervalSeconds = 5
          BackoffRate     = 2.0
        }]
        Next = "CampaignFailed"
      }

      CampaignFailed = {
        Type  = "Fail"
        Error = "CampaignExecutionFailed"
        Cause = "See handleErrorResult for details"
      }
    }
  })

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "sfn" {
  name              = "/aws/states/${var.project}-campaign-${var.env}"
  retention_in_days = 30
  tags              = var.tags
}

# ── IAM role for Step Functions ───────────────────────────────────────────────

resource "aws_iam_role" "sfn" {
  name = "${var.project}-sfn-${var.env}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "sfn" {
  name = "sfn-policy"
  role = aws_iam_role.sfn.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeLambdas"
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          var.crm_write_service_arn,
          var.research_enrichment_agent_arn,
          var.outreach_agent_arn,
          var.voice_agent_arn,
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ]
        Resource = "*"
      }
    ]
  })
}

# ── EventBridge rule: CALL-E webhook → webhook-handler Lambda ─────────────────
# The webhook-handler reads the taskToken from DynamoDB and calls SFN SendTaskSuccess.

resource "aws_cloudwatch_event_rule" "calle_completed" {
  name           = "${var.project}-calle-completed-${var.env}"
  description    = "Route CALL-E CallCompleted events to the webhook handler"
  event_bus_name = var.agents_event_bus_name

  event_pattern = jsonencode({
    source      = ["calle.webhook"]
    detail-type = ["CallCompleted"]
  })

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "calle_completed_to_webhook_handler" {
  rule           = aws_cloudwatch_event_rule.calle_completed.name
  event_bus_name = var.agents_event_bus_name
  target_id      = "webhook-handler"
  arn            = var.webhook_handler_arn
}

resource "aws_lambda_permission" "eventbridge_invoke_webhook_handler" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.webhook_handler_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.calle_completed.arn
}
