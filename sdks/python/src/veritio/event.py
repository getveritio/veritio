from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

SCHEMA_VERSION = "2026-06-10"
EDGE_SCHEMA_VERSION = "2026-06-13"
HASH_ALGORITHM = "sha256"
_SENSITIVE_KEY_PATTERN = re.compile(r"(password|secret|token|api[_-]?key|authorization|email|phone|ssn)", re.I)
_ACTION_PATTERN = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$")
_EVIDENCE_ENTITY_TYPES = {
    "tenant",
    "actor",
    "data_subject",
    "resource",
    "data_category",
    "purpose",
    "policy",
    "consent",
    "processor",
    "system",
    "repository",
    "branch",
    "commit",
    "pull_request",
    "file",
    "diff_hunk",
    "agent_session",
    "tool_call",
    "ci_run",
    "artifact",
    "deployment",
    "runtime_event",
    "subject_request",
    "export_bundle",
}
_EVIDENCE_EDGE_RELATIONS = {
    "caused_by",
    "part_of",
    "read",
    "modified",
    "created",
    "deleted",
    "derived_from",
    "reviewed_by",
    "approved_by",
    "waived_by",
    "built_by",
    "deployed_as",
    "observed_in",
    "attests_to",
    "exports",
    "satisfies_policy",
    "violates_policy",
    "subject_of",
    "processed_for",
    "retained_under",
    "sent_to",
}


def canonical_json(value: Any) -> str:
    """Return Veritio canonical JSON for hashing and cross-language fixtures."""
    return json.dumps(_normalize_json(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def create_audit_event(input_event: dict[str, Any]) -> dict[str, Any]:
    """Normalize host audit input into the language-neutral audit event schema."""
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


def create_evidence_edge(input_edge: dict[str, Any]) -> dict[str, Any]:
    """Create a validated evidence-graph edge without changing audit semantics."""
    from_entity = _clean_evidence_entity(input_edge.get("from", {}), "from")
    to_entity = _clean_evidence_entity(input_edge.get("to", {}), "to")
    if input_edge.get("relation") not in _EVIDENCE_EDGE_RELATIONS:
        raise TypeError("relation must be a supported evidence graph relation")

    edge = {
        "id": input_edge.get("id") or f"edge_{uuid.uuid4()}",
        "schemaVersion": EDGE_SCHEMA_VERSION,
        "occurredAt": _normalize_datetime(input_edge.get("occurredAt") or datetime.now(timezone.utc)),
        "scope": _without_none(input_edge["scope"]) if input_edge.get("scope") else None,
        "from": from_entity,
        "relation": input_edge["relation"],
        "to": to_entity,
        "metadata": _redact_metadata(input_edge.get("metadata") or {}),
    }
    return _without_none(edge)


def hash_audit_event(event: dict[str, Any], previous_hash: str | None = None) -> str:
    """Hash an audit event with the previous tenant-chain hash."""
    payload = canonical_json({"event": event, "previousHash": previous_hash})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def hash_evidence_edge(edge: dict[str, Any], previous_hash: str | None = None) -> str:
    """Hash an evidence edge with the previous edge-chain hash."""
    payload = canonical_json({"edge": edge, "previousHash": previous_hash})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def hash_audit_record(record: dict[str, Any]) -> str:
    """Recompute an audit record envelope hash while excluding its stored hash."""
    payload = {key: value for key, value in record.items() if key != "hash"}
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def hash_evidence_edge_record(record: dict[str, Any]) -> str:
    """Recompute an evidence-edge record envelope hash without its stored hash."""
    payload = {key: value for key, value in record.items() if key != "hash"}
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def hash_idempotency_key(tenant_id: str, idempotency_key: str) -> str:
    """Hash idempotency keys with tenant scope to avoid cross-tenant collisions."""
    _assert_non_empty(tenant_id, "tenantId")
    _assert_non_empty(idempotency_key, "idempotencyKey")
    return hashlib.sha256(f"{tenant_id}\0{idempotency_key}".encode("utf-8")).hexdigest()


def _redact_metadata(value: dict[str, Any]) -> dict[str, Any]:
    """Apply deterministic sensitive-key redaction to metadata before hashing."""
    return _redact_any(value, "")


def _redact_any(value: Any, key: str) -> Any:
    """Recursively convert metadata to JSON-compatible values with redaction."""
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
    """Normalize Python values into the canonical JSON value domain."""
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
    """Normalize date strings and datetimes to UTC millisecond ISO strings."""
    if isinstance(value, datetime):
        date = value
    else:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    date = date.astimezone(timezone.utc)
    return date.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _clean_evidence_entity(value: dict[str, Any], field: str) -> dict[str, Any]:
    """Validate and strip evidence graph entities to the public vocabulary."""
    _assert_non_empty(value.get("type"), f"{field}.type")
    _assert_non_empty(value.get("id"), f"{field}.id")
    if value["type"] not in _EVIDENCE_ENTITY_TYPES:
        raise TypeError(f"{field}.type must be a supported evidence graph entity type")

    return _without_none(
        {
            "type": value["type"],
            "id": value["id"],
            "actorType": value.get("actorType"),
            "resourceType": value.get("resourceType"),
            "version": value.get("version"),
            "pathHash": value.get("pathHash"),
        }
    )


def _assert_non_empty(value: Any, field: str) -> None:
    """Require non-empty string fields at protocol boundaries."""
    if not isinstance(value, str) or not value.strip():
        raise TypeError(f"{field} is required")


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    """Drop absent optional fields so canonical JSON matches other SDKs."""
    return {key: nested_value for key, nested_value in value.items() if nested_value is not None}
