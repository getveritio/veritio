from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

SCHEMA_VERSION = "2026-06-10"
HASH_ALGORITHM = "sha256"
_SENSITIVE_KEY_PATTERN = re.compile(r"(password|secret|token|api[_-]?key|authorization|email|phone|ssn)", re.I)
_ACTION_PATTERN = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$")


def canonical_json(value: Any) -> str:
    return json.dumps(_normalize_json(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def create_audit_event(input_event: dict[str, Any]) -> dict[str, Any]:
    _assert_non_empty(input_event.get("actor", {}).get("id"), "actor.id")
    _assert_non_empty(input_event.get("actor", {}).get("type"), "actor.type")
    _assert_non_empty(input_event.get("action"), "action")
    _assert_non_empty(input_event.get("target", {}).get("id"), "target.id")
    _assert_non_empty(input_event.get("target", {}).get("type"), "target.type")
    if not _ACTION_PATTERN.fullmatch(input_event["action"]):
        raise TypeError("action must use dotted lowercase protocol form")

    event = {
        "id": input_event.get("id") or f"evt_{uuid.uuid4()}",
        "schemaVersion": SCHEMA_VERSION,
        "occurredAt": _normalize_datetime(input_event.get("occurredAt") or datetime.now(timezone.utc)),
        "actor": _without_none(input_event["actor"]),
        "action": input_event["action"],
        "target": _without_none(input_event["target"]),
        "scope": _without_none(input_event["scope"]) if input_event.get("scope") else None,
        "requestId": input_event.get("requestId"),
        "purpose": input_event.get("purpose"),
        "lawfulBasis": input_event.get("lawfulBasis"),
        "dataCategories": sorted(set(input_event["dataCategories"])) if input_event.get("dataCategories") else None,
        "retention": input_event.get("retention"),
        "metadata": _redact_metadata(input_event.get("metadata") or {}),
    }
    return _without_none(event)


def hash_audit_event(event: dict[str, Any], previous_hash: str | None = None) -> str:
    payload = canonical_json({"event": event, "previousHash": previous_hash})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def hash_audit_record(record: dict[str, Any]) -> str:
    payload = {key: value for key, value in record.items() if key != "hash"}
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def hash_idempotency_key(tenant_id: str, idempotency_key: str) -> str:
    _assert_non_empty(tenant_id, "tenantId")
    _assert_non_empty(idempotency_key, "idempotencyKey")
    return hashlib.sha256(f"{tenant_id}\0{idempotency_key}".encode("utf-8")).hexdigest()


def _redact_metadata(value: dict[str, Any]) -> dict[str, Any]:
    return _redact_any(value, "")


def _redact_any(value: Any, key: str) -> Any:
    if _SENSITIVE_KEY_PATTERN.search(key):
        return "[redacted]"
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, list):
        return [_redact_any(item, key) for item in value]
    if isinstance(value, datetime):
        return _normalize_datetime(value)
    if isinstance(value, dict):
        return {nested_key: _redact_any(nested_value, nested_key) for nested_key, nested_value in sorted(value.items())}
    return str(value)


def _normalize_json(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, list):
        return [_normalize_json(item) for item in value]
    if isinstance(value, datetime):
        return _normalize_datetime(value)
    if isinstance(value, dict):
        return {
            key: _normalize_json(nested_value)
            for key, nested_value in sorted(value.items())
        }
    raise TypeError(f"unsupported JSON value type: {type(value).__name__}")


def _normalize_datetime(value: str | datetime) -> str:
    if isinstance(value, datetime):
        date = value
    else:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    date = date.astimezone(timezone.utc)
    return date.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _assert_non_empty(value: Any, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise TypeError(f"{field} is required")


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: nested_value for key, nested_value in value.items() if nested_value is not None}
