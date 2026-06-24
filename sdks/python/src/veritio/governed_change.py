from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone
from typing import Any, Callable

from .event import _normalize_json, canonical_json

RESERVED_CONTEXT_KEYS = [
    "authSessionId",
    "authContextId",
    "activityEpisodeId",
    "traceId",
    "correlationId",
    "causationEventId",
    "changeId",
    "capturePolicyId",
    "collectionSource",
]


def ref_key(ref: dict[str, Any]) -> str:
    """Format an authority-qualified evidence reference for stable joins."""
    _assert_ref(ref)
    return f"{ref['authority']}:{ref['kind']}:{ref['type']}:{ref['id']}"


def merge_veritio_metadata(
    caller_metadata: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Merge caller metadata with SDK-owned context keys without shadowing."""
    caller = caller_metadata or {}
    for key in RESERVED_CONTEXT_KEYS:
        if key in caller:
            raise TypeError(f"metadata.{key} is reserved by Veritio")

    merged = {key: value for key, value in sorted(caller.items()) if value is not None}
    for key in RESERVED_CONTEXT_KEYS:
        if context and context.get(key) is not None:
            merged[key] = context[key]
    return merged


def define_entity(
    *,
    authority: str,
    entity_type: str,
    schema_ref: str,
    field_set_ref: str,
    identity: Callable[[dict[str, Any]], str],
    fields: dict[str, dict[str, str]],
    lineage_policy: str | None = None,
) -> dict[str, Any]:
    """Register governed entity capture policy at the host boundary."""
    _assert_non_empty(authority, "authority")
    _assert_non_empty(entity_type, "type")
    _assert_non_empty(schema_ref, "schemaRef")
    _assert_non_empty(field_set_ref, "fieldSetRef")
    entity = {
        "authority": authority,
        "type": entity_type,
        "schemaRef": schema_ref,
        "fieldSetRef": field_set_ref,
        "identity": identity,
        "fields": fields,
    }
    if lineage_policy:
        entity["lineagePolicy"] = lineage_policy
    return entity


def create_governed_change_draft(input_change: dict[str, Any]) -> dict[str, Any]:
    """Create current-protocol audit events and edges for a governed change."""
    scope = input_change["scope"]
    _assert_non_empty(scope.get("tenantId"), "scope.tenantId")
    entity = input_change["entity"]
    after = input_change["after"]
    entity_ref = _entity_ref(entity, after)
    change = input_change["change"]
    activity = input_change["activity"]
    producer = input_change["producer"]
    _assert_ref(change["initiatedBy"])
    _assert_ref(activity["performedBy"])
    _assert_ref(producer)
    occurred_at = _normalize_datetime(input_change["occurredAt"])

    change_ref = {"authority": "veritio", "kind": "change", "type": change["type"], "id": change["id"]}
    activity_ref = {"authority": "veritio", "kind": "activity", "type": activity["type"], "id": activity["id"]}
    previous_revision_ref = input_change.get("expectedParentRevisionRef") or {
        "authority": "veritio",
        "kind": "revision",
        "type": entity["type"],
        "id": f"rev_{entity['type']}_{entity_ref['id']}_previous",
    }
    _assert_ref(previous_revision_ref)
    state_commitment = _state_commitment(entity, after, input_change.get("digestKeys") or {})
    revision_ref = {
        "authority": "veritio",
        "kind": "revision",
        "type": entity["type"],
        "id": f"rev_{entity['type']}_{entity_ref['id']}_{state_commitment['digest'][len('sha256:'):len('sha256:') + 12]}",
    }
    revision = {
        "ref": revision_ref,
        "entity": entity_ref,
        "parents": [previous_revision_ref] if input_change.get("before") else [],
        "stateCommitment": state_commitment,
        "changedPaths": sorted(input_change.get("changedPaths") or []),
        "generatedBy": activity_ref,
    }
    if input_change.get("capturePolicyRef"):
        revision["capturePolicyRef"] = input_change["capturePolicyRef"]

    metadata = merge_veritio_metadata(input_change.get("metadata"), input_change.get("context"))
    capture_assurance = {
        "captureMethod": "transactional_outbox",
        "mutationBinding": input_change.get("mutationBinding") or "not_transaction_bound",
    }
    common = {
        "scope": scope,
        "occurredAt": occurred_at,
        "purpose": "change_provenance",
        "dataCategories": ["source_reference"],
        "retention": "change_1y",
    }
    events = [
        {
            **common,
            "id": f"evt_change_declared_{change['id']}",
            "actor": _principal_from_ref(change["initiatedBy"]),
            "action": "change.declared",
            "target": {"type": "change", "id": change["id"]},
            "metadata": _compact({
                **metadata,
                "recordType": "change.declared",
                "recordAuthority": change_ref["authority"],
                "producer": producer,
                "initiatedBy": change["initiatedBy"],
                "changeType": change["type"],
                "idempotencyKeyHash": input_change["idempotencyKeyHash"],
                "capturePolicyRef": input_change.get("capturePolicyRef"),
                "authorizationAssertionRef": change.get("authorizationAssertionRef"),
                "delegationAssertionRef": change.get("delegationAssertionRef"),
                "captureAssurance": capture_assurance,
            }),
        },
        {
            **common,
            "id": f"evt_activity_recorded_{activity['id']}",
            "actor": _principal_from_ref(activity["performedBy"]),
            "action": "activity.recorded",
            "target": {"type": "activity", "id": activity["id"]},
            "metadata": _compact({
                **metadata,
                "recordType": "activity.recorded",
                "recordAuthority": activity_ref["authority"],
                "producer": producer,
                "performedBy": activity["performedBy"],
                "activityType": activity["type"],
                "idempotencyKeyHash": input_change["idempotencyKeyHash"],
                "captureAssurance": capture_assurance,
            }),
        },
        {
            **common,
            "id": f"evt_entity_revision_{revision_ref['id']}",
            "actor": _principal_from_ref(producer),
            "action": "entity.revision.created",
            "target": {"type": entity["type"], "id": entity_ref["id"]},
            "metadata": _compact({
                **metadata,
                "recordType": "entity.revision",
                "recordAuthority": revision_ref["authority"],
                "producer": producer,
                "idempotencyKeyHash": input_change["idempotencyKeyHash"],
                "veritio": {"revision": revision},
                "captureAssurance": capture_assurance,
            }),
        },
    ]
    edges = [
        _draft_edge("has_activity", change_ref, activity_ref, occurred_at, scope),
        _draft_edge("has_output", change_ref, revision_ref, occurred_at, scope),
        _draft_edge("performed_by", activity_ref, activity["performedBy"], occurred_at, scope),
        _draft_edge("generated", activity_ref, revision_ref, occurred_at, scope),
    ]
    if input_change.get("before"):
        edges.append(_draft_edge("derived_from", revision_ref, previous_revision_ref, occurred_at, scope))

    outbox_entry = {
        "schemaVersion": "2026-06-23",
        "mutationBinding": capture_assurance["mutationBinding"],
        "records": events,
        "edges": edges,
    }
    if input_change.get("before"):
        outbox_entry["expectedParentRevisionRef"] = previous_revision_ref

    return {
        "changeRef": change_ref,
        "activityRef": activity_ref,
        "entityRef": entity_ref,
        "revision": revision,
        "events": events,
        "edges": edges,
        "outboxEntry": outbox_entry,
    }


def _state_commitment(entity: dict[str, Any], row: dict[str, Any], digest_keys: dict[str, Any]) -> dict[str, Any]:
    """Apply field capture policy before evidence leaves the host process."""
    fields: dict[str, Any] = {}
    for key in sorted(entity["fields"].keys()):
        policy = entity["fields"][key]
        mode = policy.get("capture")
        if mode == "omit" or key not in row:
            continue
        value = row[key]
        if mode == "full":
            fields[key] = _normalize_json(value)
        elif mode == "keyed_digest":
            keyed_digest = digest_keys.get("keyedDigest")
            if not keyed_digest:
                raise TypeError("digestKeys.keyedDigest is required for keyed_digest fields")
            _assert_non_empty(keyed_digest.get("keyVersion"), "digestKeys.keyedDigest.keyVersion")
            _assert_non_empty(keyed_digest.get("secret"), "digestKeys.keyedDigest.secret")
            fields[key] = {
                "algorithm": "hmac-sha256",
                "keyVersion": keyed_digest["keyVersion"],
                "digest": _prefixed_hmac_sha256(canonical_json(value), keyed_digest["secret"]),
            }
        elif mode == "content_digest":
            fields[key] = {"captureMode": mode, "digest": _prefixed_sha256(canonical_json(value))}
        else:
            raise TypeError(f"capture mode {mode} is not supported by the current governed-change draft helper")

    return {
        "algorithm": "sha256",
        "canonicalization": "veritio-json-v1",
        "schemaRef": entity["schemaRef"],
        "fieldSetRef": entity["fieldSetRef"],
        "fields": fields,
        "digest": _prefixed_sha256(canonical_json(fields)),
    }


def _draft_edge(relation: str, from_ref: dict[str, Any], to_ref: dict[str, Any], occurred_at: str, scope: dict[str, Any]) -> dict[str, Any]:
    """Build an EvidenceEdge input while preserving structured refs in metadata."""
    return {
        "id": f"edge_{relation}_{_stable_id(ref_key(from_ref))}_{_stable_id(ref_key(to_ref))}",
        "occurredAt": occurred_at,
        "scope": scope,
        "from": _entity_from_ref(from_ref),
        "relation": relation,
        "to": _entity_from_ref(to_ref),
        "metadata": {"fromRef": from_ref, "toRef": to_ref},
    }


def _entity_ref(entity: dict[str, Any], row: dict[str, Any]) -> dict[str, str]:
    """Resolve a host row into an authority-qualified entity ref."""
    entity_id = entity["identity"](row)
    _assert_non_empty(entity_id, "entity.id")
    return {"authority": entity["authority"], "kind": "entity", "type": entity["type"], "id": entity_id}


def _entity_from_ref(ref: dict[str, Any]) -> dict[str, str]:
    """Map EvidenceRef into the current EvidenceEdge endpoint shape."""
    endpoint_type = "evidence_commit" if ref["kind"] == "commit" else ref["kind"]
    entity = {"type": endpoint_type, "id": ref["id"], "resourceType": ref["type"]}
    if ref["kind"] == "principal" and ref["type"] in {"user", "service", "system", "ai_agent"}:
        entity["actorType"] = ref["type"]
    return entity


def _principal_from_ref(ref: dict[str, Any]) -> dict[str, str]:
    """Convert a principal ref into the legacy AuditEvent actor shape."""
    if ref.get("kind") != "principal":
        raise TypeError("principal ref is required")
    return {"type": ref["type"], "id": f"{ref['authority']}:{ref['id']}"}


def _compact(value: dict[str, Any]) -> dict[str, Any]:
    """Drop absent optional fields before event normalization redacts metadata."""
    return {key: nested for key, nested in value.items() if nested is not None}


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


def _stable_id(value: str) -> str:
    """Produce a short deterministic ID token for generated edge IDs."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def _prefixed_sha256(value: str) -> str:
    """Compute the prefixed SHA-256 digest string used by commitments."""
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _prefixed_hmac_sha256(value: str, secret: str) -> str:
    """Compute a host-keyed digest without persisting raw key or raw value."""
    return "sha256:" + hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def _assert_ref(ref: dict[str, Any]) -> None:
    """Validate the authority-qualified reference shape."""
    _assert_non_empty(ref.get("authority"), "ref.authority")
    _assert_non_empty(ref.get("kind"), "ref.kind")
    _assert_non_empty(ref.get("type"), "ref.type")
    _assert_non_empty(ref.get("id"), "ref.id")


def _assert_non_empty(value: Any, field: str) -> None:
    """Require non-empty public string fields."""
    if not isinstance(value, str) or not value.strip():
        raise TypeError(f"{field} is required")
