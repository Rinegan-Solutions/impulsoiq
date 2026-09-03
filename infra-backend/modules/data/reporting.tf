# ── Phase 3 data stores ────────────────────────────────────────────────────────
#
# Two new tables introduced in Phase 3, both isolated from the OLTP path:
#
#   reporting  — pre-computed forecasts, risk flags, quality scores
#                Written by agents; read by non-agentic dashboards.
#                Kept separate to sidestep DSQL contention on heavy reads.
#
#   metering   — per-tenant, per-billing-period usage counters
#                Written via atomic DynamoDB ADD by the metering-aggregator Lambda.
#                Checked SYNCHRONOUSLY by the Coordinator before every metered action.
#                (Phase 3C spec: checked pre-action, not just reported after.)

# ── Reporting table ────────────────────────────────────────────────────────────
# PK:  {tenantId}#report#{reportType}
#      e.g. demo#report#pipeline_forecast
# SK:  {generatedAt}   ISO-8601 timestamp
# TTL: 90 days (reporting data ages out)

resource "aws_dynamodb_table" "reporting" {
  name         = "${var.project}-reporting-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "report_type"
    type = "S"
  }
  attribute {
    name = "tenant_id"
    type = "S"
  }

  # Query "latest forecasts across all tenants" (admin view, evaluations runner)
  global_secondary_index {
    name            = "gsi-by-type"
    hash_key        = "report_type"
    range_key       = "tenant_id"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = var.tags
}

# ── Metering table ─────────────────────────────────────────────────────────────
# PK:  {tenantId}#meter#{period}   period = YYYY-MM
#      e.g. demo#meter#2026-09
# SK:  {resourceType}
#      one of: llm_tokens | call_minutes | enrichment_lookups |
#              email_sends | sms_sends | agent_runs
#
# count:      atomic Number — incremented by metering-aggregator
# cost_units: Number — computed cost in micro-USD (divide by 1_000_000 for USD)
# quota:      Number — per-tier limit for this period (written once at period start)
# TTL:        13 months (billing audit retention)

resource "aws_dynamodb_table" "metering" {
  name         = "${var.project}-metering-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = var.tags
}
