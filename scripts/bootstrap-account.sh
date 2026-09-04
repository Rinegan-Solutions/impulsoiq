#!/usr/bin/env bash
#
# One-time, per-AWS-account/region bootstrap for ImpulsoIQ.
#
# WHY THIS IS NOT TERRAFORM
# API Gateway stores ONE CloudWatch Logs role ARN per account per region. It is
# not a per-environment resource. If dev, test and prod each declared
# aws_api_gateway_account, all three Terraform states would claim the same
# global setting: every apply would overwrite the others, each plan would show a
# spurious diff, and `terraform destroy` in any one environment would silently
# break logging in the other two. So it is bootstrapped once, alongside the
# Terraform state bucket, and left out of every environment's state.
#
# Without it, creating a WebSocket stage with logging enabled fails:
#   BadRequestException: CloudWatch Logs role ARN must be set in account
#   settings to enable logging
# (see infra-backend/modules/api/websocket.tf -> default_route_settings)
#
# Requires credentials that can create an IAM role -- the scoped CodeBuild
# Terraform roles deliberately cannot (their iam:CreateRole is limited to
# impulsoiq-*-<env>). Run this as an admin before the first pipeline deploy.
#
# Idempotent: safe to re-run.
#
# Usage:
#   ./scripts/bootstrap-account.sh [region]

set -euo pipefail

REGION="${1:-eu-west-2}"
ROLE_NAME="impulsoiq-apigw-cloudwatch"
POLICY_ARN="arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"

echo "region: $REGION"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "account: $ACCOUNT_ID"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# ── 1. Terraform state bucket ────────────────────────────────────────────────
BUCKET="impulsoiq-tf-state"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "state bucket: $BUCKET already exists"
else
  echo "state bucket: creating $BUCKET"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION"
  # Versioning is what makes a corrupted or clobbered state recoverable.
  aws s3api put-bucket-versioning \
    --bucket "$BUCKET" --versioning-configuration Status=Enabled
  aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi
# No DynamoDB lock table: environments/*/backend.hcl sets use_lockfile = true,
# so the lock is an S3 conditional write on <key>.tflock in this same bucket.

# ── 2. API Gateway account-level CloudWatch Logs role ────────────────────────
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "apigw role: $ROLE_NAME already exists"
else
  echo "apigw role: creating $ROLE_NAME"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --description "Lets API Gateway write execution and access logs to CloudWatch (account-wide)" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "apigateway.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
fi

aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY_ARN"
echo "apigw role: policy attached"

# A freshly created role is not immediately visible to API Gateway's own
# validation, which rejects the update rather than waiting. Retry briefly.
echo "apigw account: pointing at $ROLE_ARN"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if aws apigateway update-account \
       --region "$REGION" \
       --patch-operations "op=replace,path=/cloudwatchRoleArn,value=${ROLE_ARN}" \
       >/dev/null 2>&1; then
    echo "apigw account: set"
    break
  fi
  if [ "$attempt" -eq 10 ]; then
    echo "ERROR: could not set cloudwatchRoleArn after 10 attempts." >&2
    aws apigateway update-account \
      --region "$REGION" \
      --patch-operations "op=replace,path=/cloudwatchRoleArn,value=${ROLE_ARN}" >&2
    exit 1
  fi
  echo "  attempt $attempt failed (IAM still propagating), retrying in 5s..."
  sleep 5
done

echo
echo "Current account setting:"
aws apigateway get-account --region "$REGION" --query cloudwatchRoleArn --output text
echo
echo "Bootstrap complete. The remaining pre-flight item is the SSM parameter"
echo "/impulsoiq/cicd/codeconnections_arn (see ci-cd/infra-backend-pipeline.yaml)."
