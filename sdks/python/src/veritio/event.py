from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any

SCHEMA_VERSION = "2026-06-10"
EDGE_SCHEMA_VERSION = "2026-06-13"
EVIDENCE_COMMIT_SCHEMA_VERSION = "2026-06-23"
HASH_ALGORITHM = "sha256"
EVIDENCE_COMMIT_TREE_ALGORITHM = "veritio-merkle-v1"
_SENSITIVE_KEY_PATTERN = re.compile(r"(password|secret|token|api[_-]?key|authorization|email|phone|ssn)", re.I)
_ACTION_PATTERN = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$")
_SHA256_DIGEST_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
_EVIDENCE_COMMIT_MEMBER_RECORD_TYPES = {
    "audit.record",
    "evidence.edge.record",
    "entity.revision.record",
    "activity.record",
    "assertion.record",
    "change.record",
}
_EVIDENCE_ENTITY_TYPES = {
    "tenant",
    "principal",
    "actor",
    "activity",
    "change",
    "revision",
    "assertion",
    "record",
    "evidence_commit",
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
    "activity_episode",
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
    "has_activity",
    "has_input",
    "has_output",
    "has_assertion",
    "resulted_in",
    "performed_by",
    "used",
    "generated",
    "based_on",
    "asserts_about",
    "retracts",
    "corrects",
    "supersedes",
    "disputes",
    "confirms",
    "compensates",
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
        "scope": _clean_scope(input_event["scope"]) if input_event.get("scope") else None,
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
        "scope": _clean_scope(input_edge["scope"]) if input_edge.get("scope") else None,
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


def create_evidence_commit(input_commit: dict[str, Any]) -> dict[str, Any]:
    """Create an EvidenceCommit for one atomic evidence append manifest."""
    _assert_non_empty(input_commit.get("commitId"), "commitId")
    _assert_non_empty(input_commit.get("streamId"), "streamId")
    _assert_positive_integer(input_commit.get("sequence"), "sequence")
    previous_hash = input_commit.get("previousCommitHash")
    if previous_hash is not None and not _is_sha256_digest(previous_hash):
        raise TypeError("previousCommitHash must be null or sha256 digest")

    members = _normalize_commit_members(input_commit.get("members"))
    commit = {
        "recordType": "evidence.commit",
        "schemaVersion": EVIDENCE_COMMIT_SCHEMA_VERSION,
        "commitId": input_commit["commitId"],
        "streamId": input_commit["streamId"],
        "sequence": input_commit["sequence"],
        "previousCommitHash": previous_hash,
        "members": members,
        "recordCount": len(members),
        "recordsRoot": _compute_records_root(members),
        "canonicalization": "veritio-json-v1",
        "hashAlgorithm": HASH_ALGORITHM,
        "treeAlgorithm": EVIDENCE_COMMIT_TREE_ALGORITHM,
        "committedAt": _normalize_datetime(input_commit.get("committedAt") or datetime.now(timezone.utc)),
    }
    commit["hash"] = hash_evidence_commit(commit)
    return commit


def hash_evidence_commit(commit: dict[str, Any]) -> str:
    """Hash an EvidenceCommit over canonical fields excluding its stored hash."""
    commit_without_hash = {key: value for key, value in commit.items() if key != "hash"}
    return _prefixed_sha256(canonical_json({"domain": "veritio-commit-v1", "commit": commit_without_hash}))


def verify_evidence_commits(commits: list[dict[str, Any]]) -> dict[str, Any]:
    """Verify EvidenceCommit chains independently per stream id.

    Verification scope (v1): proves the commit LEDGER's internal consistency
    only — it deliberately does NOT reconcile member record hashes against
    independently verified records, so a fabricated commit chain verifies ok
    in isolation. Per-record integrity comes from verify_audit_records /
    verify_evidence_edge_records; compose both for end-to-end evidence
    verification. See spec/evidence-commit-hashing.md.
    """
    stream_state: dict[str, dict[str, Any]] = {}
    for index, commit in enumerate(commits):
        if commit.get("hashAlgorithm") != HASH_ALGORITHM:
            return {"ok": False, "index": index, "reason": "unsupported_hash_algorithm"}
        if commit.get("canonicalization") != "veritio-json-v1":
            return {"ok": False, "index": index, "reason": "unsupported_canonicalization"}
        if commit.get("treeAlgorithm") != EVIDENCE_COMMIT_TREE_ALGORITHM:
            return {"ok": False, "index": index, "reason": "unsupported_tree_algorithm"}
        if not isinstance(commit.get("streamId"), str) or not commit["streamId"]:
            return {"ok": False, "index": index, "reason": "invalid_member_manifest"}
        if not isinstance(commit.get("hash"), str):
            return {"ok": False, "index": index, "reason": "hash_mismatch"}

        state = stream_state.get(commit["streamId"], {"previousHash": None, "sequence": 0})
        if commit.get("previousCommitHash") != state["previousHash"]:
            return {"ok": False, "index": index, "reason": "previous_hash_mismatch"}
        if commit.get("sequence") != state["sequence"] + 1:
            return {"ok": False, "index": index, "reason": "sequence_mismatch"}
        try:
            members = _normalize_commit_members(commit.get("members"))
        except TypeError:
            return {"ok": False, "index": index, "reason": "invalid_member_manifest"}
        if commit.get("recordCount") != len(members):
            return {"ok": False, "index": index, "reason": "record_count_mismatch"}
        if commit.get("recordsRoot") != _compute_records_root(members):
            return {"ok": False, "index": index, "reason": "records_root_mismatch"}
        if commit.get("hash") != hash_evidence_commit(commit):
            return {"ok": False, "index": index, "reason": "hash_mismatch"}

        stream_state[commit["streamId"]] = {"previousHash": commit["hash"], "sequence": commit["sequence"]}
    return {"ok": True}


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
        digest_envelope = _sanitize_digest_envelope(value)
        if digest_envelope is not None:
            return digest_envelope
        return "[redacted]"
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, list):
        return [_redact_any(item, key) for item in value]
    if isinstance(value, datetime):
        return _normalize_datetime(value)
    if isinstance(value, dict):
        digest_envelope = _sanitize_digest_envelope(value)
        if digest_envelope is not None:
            return digest_envelope
        return {nested_key: _redact_any(nested_value, nested_key) for nested_key, nested_value in sorted(value.items())}
    return str(value)


def _sanitize_digest_envelope(value: Any) -> dict[str, Any] | None:
    """Return only the allowlisted minimized digest envelope shape."""
    if not isinstance(value, dict):
        return None
    digest = value.get("digest")
    if not isinstance(digest, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        return None
    if any(key in value for key in ("canonicalization", "schemaRef", "fieldSetRef", "fields")):
        return None
    if value.get("algorithm") == "hmac-sha256":
        key_version = value.get("keyVersion")
        if isinstance(key_version, str) and key_version.strip():
            return {"algorithm": "hmac-sha256", "digest": digest, "keyVersion": key_version}
        return None
    if value.get("algorithm") == "sha256":
        return {"algorithm": "sha256", "digest": digest}
    if value.get("captureMode") in {"content_digest", "randomized_digest", "reference", "redact", "encrypt"}:
        return {"captureMode": value["captureMode"], "digest": digest}
    return None


def _normalize_json(value: Any) -> Any:
    """Normalize Python values into the canonical JSON value domain.

    Whole-valued finite floats are coerced to int so canonical JSON renders "1"/"0"
    (matching TypeScript JSON.stringify and Go encoding/json) rather than Python's
    "1.0"/"0.0". The risk scorer deterministically emits whole floats (multiplier
    weights of 1.0, zero-magnitude contributions of 0.0, clamped 1.0 / floored 0.0
    scores), so without this coercion a SCORED security.risk assertion or
    security.risk.assessed event would hash differently in Python than in TS/Go.
    Non-finite floats (NaN/Infinity) fail closed: canonical JSON cannot represent
    them and an integrity hash must never be computed over one.
    """
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("canonical JSON cannot represent a non-finite number")
        return int(value) if value.is_integer() else value
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


def _assert_positive_integer(value: Any, field: str) -> None:
    """Require positive integer sequence values in commit hash inputs."""
    if not isinstance(value, int) or value < 1:
        raise TypeError(f"{field} must be a positive integer")


def _normalize_commit_members(members: Any) -> list[dict[str, Any]]:
    """Normalize and validate ordered EvidenceCommit members."""
    if not isinstance(members, list) or len(members) == 0:
        raise TypeError("members must not be empty")
    sorted_members = sorted((_clean_commit_member(member) for member in members), key=lambda member: member["index"])
    identities: set[tuple[str, str]] = set()
    for expected_index, member in enumerate(sorted_members):
        if member["index"] != expected_index:
            raise TypeError("member indices must be contiguous from zero")
        identity = (member["recordType"], member["recordId"])
        if identity in identities:
            raise TypeError("duplicate commit member")
        identities.add(identity)
    return sorted_members


def _clean_commit_member(member: dict[str, Any]) -> dict[str, Any]:
    """Validate one commit member and drop non-protocol fields."""
    if not isinstance(member, dict):
        raise TypeError("commit member must be an object")
    index = member.get("index")
    if not isinstance(index, int) or index < 0:
        raise TypeError("member index must be a non-negative integer")
    if member.get("recordType") not in _EVIDENCE_COMMIT_MEMBER_RECORD_TYPES:
        raise TypeError("recordType must be a supported commit member record type")
    _assert_non_empty(member.get("recordId"), "recordId")
    if not _is_sha256_digest(member.get("recordHash")):
        raise TypeError("recordHash must be a sha256 digest")
    return {
        "index": index,
        "recordType": member["recordType"],
        "recordId": member["recordId"],
        "recordHash": member["recordHash"],
    }


def _compute_records_root(members: list[dict[str, Any]]) -> str:
    """Compute a veritio-merkle-v1 root, duplicating odd leaves at each level."""
    level = [_commit_leaf_hash(member) for member in members]
    while len(level) > 1:
        next_level = []
        for index in range(0, len(level), 2):
            left = level[index]
            right = level[index + 1] if index + 1 < len(level) else left
            next_level.append(_prefixed_sha256(canonical_json({"domain": "veritio-merkle-node-v1", "left": left, "right": right})))
        level = next_level
    return level[0]


def _commit_leaf_hash(member: dict[str, Any]) -> str:
    """Hash a single commit member with a leaf-specific domain separator."""
    return _prefixed_sha256(
        canonical_json(
            {
                "domain": "veritio-record-leaf-v1",
                "index": member["index"],
                "recordType": member["recordType"],
                "recordId": member["recordId"],
                "recordHash": member["recordHash"],
            }
        )
    )


def _is_sha256_digest(value: Any) -> bool:
    """Check algorithm-qualified SHA-256 digests used by EvidenceCommit."""
    return isinstance(value, str) and _SHA256_DIGEST_PATTERN.fullmatch(value) is not None


def _prefixed_sha256(value: str) -> str:
    """Return an algorithm-qualified SHA-256 digest for EvidenceCommit fields."""
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


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


def _clean_scope(scope: dict[str, Any]) -> dict[str, Any] | None:
    """Keep only truthy tenant/workspace/environment scope fields, mirroring the TypeScript
    cleanScope helper and Go's `omitempty` so an empty-string optional field (e.g.
    environment: "") is dropped identically across SDKs. A retained empty field would
    otherwise change the canonical bytes and diverge the cross-language record hash.
    Returns None when nothing remains so the caller omits the scope entirely.
    """
    cleaned = {key: scope[key] for key in ("tenantId", "workspaceId", "environment") if scope.get(key)}
    return cleaned or None


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    """Drop absent optional fields so canonical JSON matches other SDKs."""
    return {key: nested_value for key, nested_value in value.items() if nested_value is not None}
