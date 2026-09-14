#!/usr/bin/env bash
# Reconcile workspace membership: every confirmed, enabled account must be in a
# workspace group, or be refused.
#
# WHY THIS RUNS IN THE PIPELINE
# tenant-provisioner's PostConfirmation trigger never blocks a confirmation, so
# when it fails (schema not yet migrated, DSQL unreachable, a bad deploy) the
# account ends up confirmed but in no Cognito group. crm-read, crm-write,
# campaign-trigger, lead-router, template-launcher and voice-bridge all refuse
# accounts without a workspace group, and the web app shows "workspace not
# ready". A failure that happened because the backend was broken is repaired by
# the next deploy of a working backend — this stage — with no manual step.
#
# WHAT IT DOES
# For each CONFIRMED + enabled account carrying custom:tenant_id and holding no
# group, it replays the exact PostConfirmation event through the provisioner, so
# the same code decides the outcome, including the join-by-email-domain check:
#   repaired  the account is now admin or member
#   refused   the provisioner disabled it (it may not join that workspace)
#   failed    still enabled with no group — the build fails and says why to look
# Accounts that already have a group are never touched, so re-running is a no-op.
#
# Usage:  scripts/reconcile-tenant-membership.sh <env> [email]
#   <env>   dev | test | prod
#   [email] reconcile only that account (manual use)
# Needs:  aws CLI, python3. Runs in the backend migrate CodeBuild stage.
set -euo pipefail

ENV_NAME="${1:?usage: reconcile-tenant-membership.sh <env> [email]}"
ONLY_EMAIL="${2:-}"
REGION="${AWS_REGION:-eu-west-2}"
FUNCTION="impulsoiq-tenant-provisioner-${ENV_NAME}"

# First interpreter that actually runs: on Windows `python3` is often the
# Microsoft Store stub, which exists on PATH but only prints an install hint.
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import json' >/dev/null 2>&1; then
    PY="$candidate"; break
  fi
done
[ -n "$PY" ] || { echo "python3 is required"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

POOL_ID="$(aws ssm get-parameter --region "$REGION" \
  --name "/impulsoiq/${ENV_NAME}/backend/cognito_user_pool_id" \
  --query 'Parameter.Value' --output text)"
echo "Reconciling workspace membership in ${POOL_ID} (env=${ENV_NAME})"

# The CLI follows ListUsers pagination itself and merges every page.
LIST_ARGS=(cognito-idp list-users --region "$REGION" --user-pool-id "$POOL_ID" --output json)
[ -n "$ONLY_EMAIL" ] && LIST_ARGS+=(--filter "email = \"${ONLY_EMAIL}\"")
aws "${LIST_ARGS[@]}" > "$WORK/users.json"

# One trigger event per candidate account, written to its own file so the
# payload never passes through shell quoting. Output: "<username>\t<event file>".
"$PY" - "$WORK/users.json" "$REGION" "$POOL_ID" "$WORK" "$ONLY_EMAIL" > "$WORK/candidates.tsv" <<'PYEOF'
import json, os, sys

users_file, region, pool_id, work, only_email = sys.argv[1:6]
users = json.load(open(users_file)).get("Users", [])

if only_email and not users:
    sys.exit(f"No user with email {only_email}")

for n, user in enumerate(users):
    name = user["Username"]
    attrs = {a["Name"]: a["Value"] for a in user.get("Attributes", [])}
    if user.get("UserStatus") != "CONFIRMED" or not user.get("Enabled", False):
        if only_email:
            sys.exit(f"{only_email} is {user.get('UserStatus')} / enabled={user.get('Enabled')}; nothing to reconcile")
        continue
    if not attrs.get("custom:tenant_id"):
        print(f"skip {name}: no custom:tenant_id", file=sys.stderr)
        continue
    event = {
        "version": "1",
        "triggerSource": "PostConfirmation_ConfirmSignUp",
        "region": region,
        "userPoolId": pool_id,
        "userName": name,
        "callerContext": {"awsSdkVersion": "reconcile-tenant-membership.sh", "clientId": ""},
        "request": {"userAttributes": attrs},
        "response": {},
    }
    path = os.path.join(work, f"event-{n}.json")
    with open(path, "w") as f:
        json.dump(event, f)
    print(f"{name}\t{path}")
PYEOF

group_count() {
  aws cognito-idp admin-list-groups-for-user --region "$REGION" --user-pool-id "$POOL_ID" \
    --username "$1" --query 'length(Groups)' --output text
}

checked=0; repaired=0; refused=0; failed=0

while IFS=$'\t' read -r USERNAME EVENT_FILE; do
  [ -n "$USERNAME" ] || continue
  checked=$((checked + 1))
  [ "$(group_count "$USERNAME")" != "0" ] && continue

  echo "  ${USERNAME}: no workspace group — replaying PostConfirmation"
  FUNCTION_ERROR="$(aws lambda invoke --region "$REGION" --function-name "$FUNCTION" \
    --cli-binary-format raw-in-base64-out --payload "file://${EVENT_FILE}" \
    --query 'FunctionError' --output text "$WORK/invoke-out.json")"
  if [ "$FUNCTION_ERROR" != "None" ]; then
    echo "  ${USERNAME}: provisioner raised ${FUNCTION_ERROR}"
    failed=$((failed + 1)); continue
  fi

  # The provisioner logs rather than throws, so re-read the account for the outcome.
  ENABLED="$(aws cognito-idp admin-get-user --region "$REGION" --user-pool-id "$POOL_ID" \
    --username "$USERNAME" --query 'Enabled' --output text)"
  if [ "$(group_count "$USERNAME")" != "0" ]; then
    echo "  ${USERNAME}: repaired"
    repaired=$((repaired + 1))
  elif [ "$ENABLED" != "True" ]; then
    echo "  ${USERNAME}: refused — may not join its workspace; account disabled"
    refused=$((refused + 1))
  else
    echo "  ${USERNAME}: STILL UNPROVISIONED"
    failed=$((failed + 1))
  fi
done < "$WORK/candidates.tsv"

echo "Membership reconciled: checked=${checked} repaired=${repaired} refused=${refused} failed=${failed}"
if [ "$failed" -gt 0 ]; then
  echo "ERROR: ${failed} account(s) could not be provisioned. See CloudWatch log group /aws/lambda/${FUNCTION}."
  exit 1
fi
