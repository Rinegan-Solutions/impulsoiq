"""
VoiceProvider — vendor-swappable outbound voice seam.

Methods: plan, run, cancel, result_schema.
The first implementation is CALL-E. A stub is allowed only when
ALLOW_VOICE_STUB=true and ENV is not prod. Production with missing
credentials refuses the call.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Protocol

import boto3
import httpx

from impulsoiq_secrets import app_secret


def _env() -> str:
    return os.environ.get("ENV", "dev")


def _is_prod() -> bool:
    return _env() == "prod"


def _api_key() -> str:
    direct = os.environ.get("CALLE_API_KEY", "")
    if direct:
        return direct
    return app_secret("calle_api_key")


def _stub_allowed() -> bool:
    if _is_prod():
        return False
    return os.environ.get("ALLOW_VOICE_STUB", "").lower() == "true"


AI_DISCLOSURE = (
    "This call is with an artificial intelligence assistant acting on behalf of "
    "the company that arranged it. This call may be recorded."
)


class VoiceProvider(Protocol):
    def plan(self, *, call_goal: str, contact: dict[str, Any], disclosure_text: str) -> dict[str, Any]: ...
    def run(self, *, to_phone: str, call_goal: str, result_schema: dict[str, Any],
            webhook_url: str, metadata: dict[str, Any], opening: str,
            idempotency_key: str) -> dict[str, Any]: ...
    def cancel(self, *, call_id: str) -> dict[str, Any]: ...
    def result_schema(self, call_goal: str) -> dict[str, Any]: ...


class CalleVoiceProvider:
    def __init__(self) -> None:
        self.base_url = os.environ.get("CALLE_BASE_URL", "").rstrip("/")
        self.api_key = _api_key()

    def plan(self, *, call_goal: str, contact: dict[str, Any], disclosure_text: str) -> dict[str, Any]:
        first = contact.get("first_name") or contact.get("firstName") or "there"
        opening = (
            f"Hello {first}. {disclosure_text} "
            "If you do not consent to this recorded AI call, please say so and I will end the call."
        )
        return {
            "callGoal": call_goal,
            "opening": opening,
            "disclosureText": disclosure_text,
            "resultSchema": self.result_schema(call_goal),
        }

    def result_schema(self, call_goal: str) -> dict[str, Any]:
        if call_goal == "meeting_confirmation":
            return {
                "type": "object",
                "properties": {
                    "confirmed": {"type": "boolean"},
                    "reschedule_requested": {"type": "boolean"},
                    "new_time_preference": {"type": "string"},
                },
                "required": ["confirmed"],
            }
        if call_goal == "follow_up":
            return {
                "type": "object",
                "properties": {
                    "interest_level": {"type": "string"},
                    "questions": {"type": "array", "items": {"type": "string"}},
                    "meeting_booked": {"type": "boolean"},
                    "objections": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["interest_level"],
            }
        return {
            "type": "object",
            "properties": {
                "budget": {"type": "string"},
                "authority": {"type": "string"},
                "need": {"type": "string"},
                "timeline": {"type": "string"},
                "interest_level": {"type": "string", "enum": ["high", "medium", "low", "none"]},
                "meeting_booked": {"type": "boolean"},
                "objections": {"type": "array", "items": {"type": "string"}},
                "next_step": {"type": "string"},
            },
            "required": ["interest_level", "meeting_booked"],
        }

    def run(self, *, to_phone: str, call_goal: str, result_schema: dict[str, Any],
            webhook_url: str, metadata: dict[str, Any], opening: str,
            idempotency_key: str) -> dict[str, Any]:
        if not self.base_url or not self.api_key:
            if _stub_allowed():
                return {
                    "callId": f"stub-{idempotency_key}",
                    "status": "initiated",
                    "source": "stub",
                    "cancelled": False,
                }
            raise RuntimeError(
                "Voice provider is not configured. Refusing to place the call "
                f"(ENV={_env()}, stub_allowed={_stub_allowed()})."
            )

        resp = httpx.post(
            f"{self.base_url}/calls",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotency_key,
            },
            json={
                "to": to_phone,
                "goal": call_goal,
                "opening": opening,
                "result_schema": result_schema,
                "webhook_url": webhook_url,
                "metadata": metadata,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "callId": data.get("id") or data.get("callId") or "",
            "status": data.get("status", "initiated"),
            "source": "calle",
        }

    def cancel(self, *, call_id: str) -> dict[str, Any]:
        if not call_id or not self.base_url or not self.api_key:
            return {"cancelled": False, "reason": "provider_unavailable"}
        if call_id.startswith("stub-"):
            return {"cancelled": True, "reason": "stub"}
        try:
            resp = httpx.post(
                f"{self.base_url}/calls/{call_id}/cancel",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=8.0,
            )
            if resp.status_code in (404, 405, 501):
                return {"cancelled": False, "reason": "vendor_has_no_cancel"}
            resp.raise_for_status()
            return {"cancelled": True, "reason": "calle"}
        except Exception as exc:
            return {"cancelled": False, "reason": str(exc)}


def get_provider() -> CalleVoiceProvider:
    return CalleVoiceProvider()


def check_dnc(phone_number: str, country: str) -> dict[str, Any]:
    """
    Fail closed. A real DNC API is used when DNC_API_URL and DNC_API_KEY are set.
    Otherwise the number is denied unless it is on DNC_TEST_NUMBERS (E.164
    allowlist for internal test numbers — never tenant-imported lists).
    """
    e164 = (phone_number or "").strip()
    test_numbers = {
        n.strip() for n in os.environ.get("DNC_TEST_NUMBERS", "").split(",") if n.strip()
    }
    api_url = os.environ.get("DNC_API_URL", "").rstrip("/")
    api_key = os.environ.get("DNC_API_KEY", "") or app_secret("dnc_api_key")

    if api_url and api_key:
        try:
            resp = httpx.post(
                f"{api_url}/check",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"phone": e164, "country": country},
                timeout=8.0,
            )
            resp.raise_for_status()
            data = resp.json()
            listed = bool(data.get("listed") or data.get("onDnc") or data.get("dnc"))
            return {
                "allowed": not listed,
                "source": "dnc_api",
                "reason": data.get("reason") or ("listed" if listed else "clear"),
            }
        except Exception as exc:
            return {"allowed": False, "source": "dnc_api", "reason": f"dnc_check_failed:{exc}"}

    if e164 and e164 in test_numbers:
        return {"allowed": True, "source": "dnc_test_allowlist", "reason": "internal_test_number"}

    return {
        "allowed": False,
        "source": "fail_closed",
        "reason": "dnc_provider_unconfigured",
    }


def store_call_task(
    *,
    table: str,
    tenant_id: str,
    contact_id: str,
    agent_run_id: str,
    task_token: str,
    idempotency_key: str,
    call_id: str,
    disclosure_text: str,
    disclosure_at: str,
    calling_window: dict[str, Any],
    dnc_result: dict[str, Any],
) -> None:
    ddb = boto3.client("dynamodb", region_name=os.environ.get("AWS_REGION", "eu-west-2"))
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    ttl = str(int(time.time()) + 86400 * 3)
    item = {
        "pk": {"S": f"{tenant_id}#call_tasks#{idempotency_key}"},
        "sk": {"S": "task_token"},
        "taskToken": {"S": task_token},
        "tenantId": {"S": tenant_id},
        "contactId": {"S": contact_id},
        "agentRunId": {"S": agent_run_id or ""},
        "idempotencyKey": {"S": idempotency_key},
        "callId": {"S": call_id or ""},
        "aiDisclosureText": {"S": disclosure_text},
        "aiDisclosureDeliveredAt": {"S": disclosure_at},
        "callingWindowAllowed": {"BOOL": bool(calling_window.get("allowed"))},
        "callingWindowReason": {"S": str(calling_window.get("reason") or "")},
        "dncResult": {"S": json.dumps(dnc_result)},
        "createdAt": {"S": now},
        "ttl": {"N": ttl},
    }
    ddb.put_item(
        TableName=table,
        Item=item,
        ConditionExpression="attribute_not_exists(pk)",
    )
    if agent_run_id:
        ddb.put_item(
            TableName=table,
            Item={
                "pk": {"S": f"{tenant_id}#call_tasks_by_run#{agent_run_id}"},
                "sk": {"S": idempotency_key},
                "callId": {"S": call_id or ""},
                "idempotencyKey": {"S": idempotency_key},
                "ttl": {"N": ttl},
            },
        )
