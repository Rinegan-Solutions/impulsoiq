"""Packed app secrets: one Secrets Manager JSON per environment."""
from __future__ import annotations

import json
import logging
import os

import boto3
from botocore.exceptions import ClientError

log = logging.getLogger("impulsoiq.secrets")

_cache: dict[str, str] | None = None
_EMPTY: dict[str, str] = {}

# Terraform creates the secret container and operators put the JSON version.
# Until that version exists, GetSecretValue raises ResourceNotFoundException
# for staging label AWSCURRENT — that is "no keys yet", not a crash.


def app_secret(key: str) -> str:
    global _cache
    arn = os.environ.get("APP_SECRET_ARN", "")
    if not arn:
        return ""
    if _cache is None:
        _cache = _load(arn)
    return (_cache.get(key) or "").strip()


def _load(arn: str) -> dict[str, str]:
    try:
        client = boto3.client(
            "secretsmanager",
            region_name=os.environ.get("AWS_REGION", "eu-west-2"),
        )
        resp = client.get_secret_value(SecretId=arn)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code", "")
        log.warning("app secret unreadable (%s): %s", code, exc)
        return _EMPTY
    except Exception as exc:  # noqa: BLE001
        log.warning("app secret unreadable: %s", exc)
        return _EMPTY

    raw = resp.get("SecretString") or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("app secret was not JSON")
        return _EMPTY
    if not isinstance(parsed, dict):
        return _EMPTY
    return {str(k): str(v) for k, v in parsed.items() if v is not None}
