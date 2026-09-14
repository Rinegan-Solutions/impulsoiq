"""Packed app secrets: one Secrets Manager JSON per environment."""
from __future__ import annotations

import json
import os

import boto3

_cache: dict[str, str] | None = None


def app_secret(key: str) -> str:
    global _cache
    arn = os.environ.get("APP_SECRET_ARN", "")
    if not arn:
        return ""
    if _cache is None:
        client = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
        resp = client.get_secret_value(SecretId=arn)
        raw = resp.get("SecretString") or "{}"
        parsed = json.loads(raw)
        _cache = {str(k): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}
    return (_cache.get(key) or "").strip()
