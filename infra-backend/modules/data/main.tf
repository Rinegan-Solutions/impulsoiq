# Aurora DSQL — system-of-record relational store
# Constraints: no triggers, no stored procs, no advisory locks, no SERIALIZABLE isolation,
# no extensions (pgvector excluded). Bulk writes must be chunked (~10k rows/txn max).

data "aws_region" "current" {}
resource "aws_dsql_cluster" "main" {
  deletion_protection_enabled = var.env == "prod"
  tags                        = var.tags
}

# DynamoDB — single-table event/audit log, session state, idempotency, metering
#
# PK:  {tenantId}#{entityType}#{entityId}
# SK:  {isoTimestamp}#{eventType}
#
# GSIs enable efficient lookup patterns without full-table scans:
#   gsi-agent-run  : query all events for an agent_run (Control Panel live feed)
#   gsi-campaign   : query all events for a campaign (analytics, metering)
#   gsi-contact    : query engagement events for a contact (Nurture agent trigger)
resource "aws_dynamodb_table" "events" {
  name         = "${var.project}-events-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk" # tenant_id#entity_type#entity_id
  range_key    = "sk" # timestamp#event_type

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "agent_run_id"
    type = "S"
  }
  attribute {
    name = "campaign_id"
    type = "S"
  }
  attribute {
    name = "contact_id"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi-agent-run"
    hash_key        = "agent_run_id"
    range_key       = "sk"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "gsi-campaign"
    hash_key        = "campaign_id"
    range_key       = "sk"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "gsi-contact"
    hash_key        = "contact_id"
    range_key       = "sk"
    projection_type = "ALL"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = var.tags
}

# S3 for transcripts, exports, attachments
resource "aws_s3_bucket" "assets" {
  bucket        = "${var.project}-assets-${var.env}"
  force_destroy = var.env != "prod"
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3 Vectors bucket for semantic/embedding memory
resource "aws_s3_bucket" "vectors" {
  bucket        = "${var.project}-vectors-${var.env}"
  force_destroy = var.env != "prod"
  tags          = var.tags
}

# EventBridge custom bus — lives here (not in api/) so both api and agentcore
# can reference it without creating a circular module dependency.
resource "aws_cloudwatch_event_bus" "agents" {
  name = "${var.project}-agents-${var.env}"
  tags = var.tags
}
