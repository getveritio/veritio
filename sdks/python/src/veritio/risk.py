"""Risk scoring math for the Veritio evidence layer.

This module is a byte-for-byte parity port of ``sdks/typescript/src/risk.ts``.
It is language-neutral protocol math: TypeScript, Python, and Go must emit
identical scores and canonical bytes, so every operation uses ONLY
clamp/floor/divide/multiply (never pow/exp/log) and every constant is pinned in
DEFAULT_RISK_POLICY. SDK core (create_audit_event) intentionally knows nothing
about scoring. The spec/conformance/*.json fixtures authored by the TypeScript
SDK are the cross-language source of truth; this module reproduces them exactly.
"""

from __future__ import annotations

import hashlib
import math
import uuid
from datetime import datetime, timezone
from typing import Any

from .event import (
    _assert_non_empty,
    _clean_scope,
    _normalize_datetime,
    canonical_json,
    hash_idempotency_key,
)
from .governed_change import _assert_ref, merge_veritio_metadata

# Enum domains mirror sdks/typescript/src/risk.ts. Field names stay language-neutral.
RISK_OPERATION_TYPES = ("read", "create", "update", "config", "bulk", "permission", "delete", "destructive")
RISK_REVERSIBILITY = ("reversible", "recoverable", "irreversible")
RISK_ENV_CRITICALITY = ("sandbox", "development", "staging", "production")
RISK_LEVELS = ("none", "low", "medium", "high", "critical")

# Reference scoring policy. These numbers are the cross-language contract: TypeScript,
# Python, and Go MUST use byte-identical constants so conformance fixtures match.
DEFAULT_RISK_POLICY: dict[str, Any] = {
    "policyVersion": "veritio.reference.v1",
    "operationBase": {
        "read": 0.05,
        "create": 0.20,
        "update": 0.30,
        "config": 0.45,
        "bulk": 0.55,
        "permission": 0.60,
        "delete": 0.70,
        "destructive": 0.85,
    },
    "reversibilityFactor": {"reversible": 0.6, "recoverable": 1.0, "irreversible": 1.3},
    "envCriticalityFactor": {"sandbox": 0.4, "development": 0.6, "staging": 0.8, "production": 1.0},
    "magnitude": {
        "maxBoost": 0.40,
        "weights": {"dataVolume": 0.5, "fanOut": 0.3, "referenceCount": 0.2},
        "k": {"dataVolume": 100, "fanOut": 25, "referenceCount": 50},
    },
    "bands": {"low": 0.05, "medium": 0.25, "high": 0.50, "critical": 0.75},
    "rollup": {"windowSeconds": 60, "decayPerWindow": 0.5, "velocityNormalizer": 3.0, "frequencyRules": []},
}


def clamp01(x: float) -> float:
    """Clamp a raw score into [0,1] with no library rounding so TS/Python/Go agree byte-for-byte."""
    return min(1.0, max(0.0, x))


def round4(x: float) -> float:
    """Half-up round to 4 decimals via integer floor (no Decimal/round) so cross-language hash bytes match."""
    return math.floor(x * 10000 + 0.5) / 10000


def _sat(x: float, k: float) -> float:
    """Saturating magnitude curve using division only (no pow/log) for deterministic cross-language output."""
    return x / (x + k)


def band_of(score: float, bands: dict[str, float]) -> str:
    """Map a clamped score to a RiskLevel using strict-less-than band edges (none<low<medium<high<critical)."""
    if score < bands["low"]:
        return "none"
    if score < bands["medium"]:
        return "low"
    if score < bands["high"]:
        return "medium"
    if score < bands["critical"]:
        return "high"
    return "critical"


def _assert_conclusion(conclusion: dict[str, Any]) -> None:
    """Fail closed unless a precomputed risk conclusion is safe to stamp into a hashed record.

    The assertion/event builders never recompute a score, so they MUST gate the
    detector-supplied conclusion before it rides into the canonical hash: score
    must be a finite number in [0,1] and level a known RiskLevel. bool is rejected
    (it subclasses int and would canonicalize as a number), and the bad value is
    never echoed, so corrupt scorer output raises a sanitized TypeError instead of
    minting an un-verifiable assertion or security.risk.assessed event.
    """
    score = conclusion.get("score")
    if (
        isinstance(score, bool)
        or not isinstance(score, (int, float))
        or not math.isfinite(score)
        or score < 0
        or score > 1
    ):
        raise TypeError("conclusion.score must be a finite number in [0,1]")
    if conclusion.get("level") not in RISK_LEVELS:
        raise TypeError("conclusion.level must be a known risk level")


def _magnitude(value: Any, field: str) -> int:
    """Default an optional magnitude to 0 and coerce integer-valued numbers to int, failing closed otherwise.

    Accepts ints AND integer-valued finite floats (e.g. 100.0) so Python matches
    TS Number.isInteger(100.0)===true and Go 100.0==Floor(100.0); rejects bool (it
    subclasses int and would skew the curve as 0/1), negatives, NaN/Inf, and
    fractional floats so a corrupt count can never quietly change the saturating
    boost. Coercion keeps the downstream factor value an int for canonical bytes.
    """
    if value is None:
        return 0
    if isinstance(value, bool):
        raise TypeError(f"{field} must be a non-negative integer")
    if isinstance(value, int):
        if value < 0:
            raise TypeError(f"{field} must be a non-negative integer")
        return value
    if isinstance(value, float):
        if not math.isfinite(value) or value < 0 or not value.is_integer():
            raise TypeError(f"{field} must be a non-negative integer")
        return int(value)
    raise TypeError(f"{field} must be a non-negative integer")


def normalize_risk_signals(signals: dict[str, Any]) -> dict[str, Any]:
    """Validate and default RiskSignals, failing closed on unknown enums or invalid magnitudes before scoring."""
    operation_type = signals.get("operationType")
    if operation_type not in RISK_OPERATION_TYPES:
        raise TypeError("operationType must be a supported risk operation type")
    reversibility = signals.get("reversibility")
    if reversibility is None:
        reversibility = "recoverable"
    elif reversibility not in RISK_REVERSIBILITY:
        raise TypeError("reversibility must be a supported risk reversibility")
    env_criticality = signals.get("envCriticality")
    if env_criticality is None:
        env_criticality = "production"
    elif env_criticality not in RISK_ENV_CRITICALITY:
        raise TypeError("envCriticality must be a supported risk environment criticality")
    return {
        "operationType": operation_type,
        "reversibility": reversibility,
        "envCriticality": env_criticality,
        "dataVolume": _magnitude(signals.get("dataVolume"), "dataVolume"),
        "fanOut": _magnitude(signals.get("fanOut"), "fanOut"),
        "referenceCount": _magnitude(signals.get("referenceCount"), "referenceCount"),
    }


def with_risk_signals(metadata: dict[str, Any] | None, signals: dict[str, Any]) -> dict[str, Any]:
    """Stamp normalized RiskSignals at metadata.riskSignals AFTER caller metadata (non-PII, intentionally un-redacted)."""
    return {**(metadata or {}), "riskSignals": normalize_risk_signals(signals)}


def score_risk_signals(signals: dict[str, Any], policy: dict[str, Any] = DEFAULT_RISK_POLICY) -> dict[str, Any]:
    """Score one RiskSignals step into a deterministic RiskAssessment with an ordered factor breakdown.

    Factor keys, ORDER, and the base-factor weight==1 / multiplier weight==contribution
    conventions are part of the cross-language conformance contract
    (spec/conformance/risk-scoring-default-policy.json, authored by the TS SDK).
    """
    normalized = normalize_risk_signals(signals)
    operation_type = normalized["operationType"]
    magnitude = policy["magnitude"]
    weights = magnitude["weights"]
    k = magnitude["k"]
    max_boost = magnitude["maxBoost"]
    base = policy["operationBase"][operation_type]
    dv_c = round4(max_boost * weights["dataVolume"] * _sat(normalized["dataVolume"], k["dataVolume"]))
    fo_c = round4(max_boost * weights["fanOut"] * _sat(normalized["fanOut"], k["fanOut"]))
    rc_c = round4(max_boost * weights["referenceCount"] * _sat(normalized["referenceCount"], k["referenceCount"]))
    reversibility_factor = policy["reversibilityFactor"][normalized["reversibility"]]
    env_factor = policy["envCriticalityFactor"][normalized["envCriticality"]]
    score = clamp01(round4((base + dv_c + fo_c + rc_c) * reversibility_factor * env_factor))
    factors = [
        {"key": "operationType", "value": operation_type, "kind": "base", "weight": 1, "contribution": base},
        {"key": "dataVolume", "value": normalized["dataVolume"], "kind": "additive", "weight": weights["dataVolume"], "contribution": dv_c},
        {"key": "fanOut", "value": normalized["fanOut"], "kind": "additive", "weight": weights["fanOut"], "contribution": fo_c},
        {"key": "referenceCount", "value": normalized["referenceCount"], "kind": "additive", "weight": weights["referenceCount"], "contribution": rc_c},
        {"key": "reversibility", "value": normalized["reversibility"], "kind": "multiplier", "weight": reversibility_factor, "contribution": reversibility_factor},
        {"key": "envCriticality", "value": normalized["envCriticality"], "kind": "multiplier", "weight": env_factor, "contribution": env_factor},
    ]
    return {"score": score, "level": band_of(score, policy["bands"]), "policyVersion": policy["policyVersion"], "factors": factors}


def _occurred_at_ms(value: str) -> int:
    """Parse an ISO occurredAt to epoch milliseconds for integer-window momentum decay."""
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return round(date.timestamp() * 1000)


def _is_integer_number(value: Any) -> bool:
    """Mirror JS Number.isInteger: reject bool/None, accept ints and integer-valued finite floats.

    Frequency-rule thresholds arrive as JSON numbers, so a whole float like 5.0 must
    validate identically to TS Number.isInteger(5.0)===true while bool (int subclass)
    and NaN/Inf never pass.
    """
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return math.isfinite(value) and value.is_integer()
    return False


def _assert_frequency_rules(rules: list[dict[str, Any]]) -> None:
    """Fail closed on malformed frequency rules before any burst detection runs.

    Mirrors sdks/typescript/src/risk-score.ts assertFrequencyRules: a corrupt rule
    (empty/blank action list, non-positive/non-finite window, fractional or sub-1
    threshold, negative or non-finite boost) must raise rather than silently disable
    or skew detection. bool is rejected everywhere (it subclasses int).
    """
    for rule in rules:
        actions = rule.get("actions")
        if (
            not isinstance(actions, list)
            or len(actions) == 0
            or any(not isinstance(action, str) or len(action) == 0 for action in actions)
        ):
            raise TypeError("frequencyRules[].actions must be a non-empty array of non-empty strings")
        window_seconds = rule.get("windowSeconds")
        if (
            isinstance(window_seconds, bool)
            or not isinstance(window_seconds, (int, float))
            or not math.isfinite(window_seconds)
            or window_seconds <= 0
        ):
            raise TypeError("frequencyRules[].windowSeconds must be a finite number greater than 0")
        threshold = rule.get("threshold")
        if not _is_integer_number(threshold) or threshold < 1:
            raise TypeError("frequencyRules[].threshold must be an integer greater than or equal to 1")
        boost = rule.get("boost")
        if (
            isinstance(boost, bool)
            or not isinstance(boost, (int, float))
            or not math.isfinite(boost)
            or boost < 0
        ):
            raise TypeError("frequencyRules[].boost must be a finite number greater than or equal to 0")


def _evaluate_frequency_rules(
    ordered: list[dict[str, Any]], rules: list[dict[str, Any]]
) -> tuple[float, list[dict[str, Any]]]:
    """Evaluate each frequency rule over time-sorted steps with an inclusive two-pointer window.

    Mirrors sdks/typescript/src/risk-score.ts evaluateFrequencyRules: for every rule,
    collect the epoch-ms of steps whose optional action exact-matches, slide a window
    (endMs - startMs <= windowSeconds*1000), take the max concurrent count, and fire at
    most once when it reaches threshold. frequencyScore is the clamped round4 sum of
    fired boosts; match.boost is 0 when not fired. Pure integer/compare math for parity.
    """
    boost_sum = 0.0
    matches: list[dict[str, Any]] = []
    for rule in rules:
        window_ms = rule["windowSeconds"] * 1000
        times_ms = [
            _occurred_at_ms(step["occurredAt"])
            for step in ordered
            if step.get("action") is not None and step["action"] in rule["actions"]
        ]
        max_count = 0
        start = 0
        for end in range(len(times_ms)):
            end_ms = times_ms[end]
            while end_ms - times_ms[start] > window_ms:
                start += 1
            count = end - start + 1
            if count > max_count:
                max_count = count
        fired = max_count >= rule["threshold"]
        if fired:
            boost_sum += rule["boost"]
        matches.append(
            {
                "actions": [*rule["actions"]],
                "windowSeconds": rule["windowSeconds"],
                "threshold": rule["threshold"],
                "count": max_count,
                "fired": fired,
                "boost": rule["boost"] if fired else 0,
            }
        )
    return clamp01(round4(boost_sum)), matches


def rollup_episode_risk(steps: list[dict[str, Any]], policy: dict[str, Any] = DEFAULT_RISK_POLICY) -> dict[str, Any]:
    """Roll time-ordered step scores into an EpisodeRiskRollup using decayed momentum.

    Momentum compounds per integer 60s window: decay = decayPerWindow ** windows via
    REPEATED MULTIPLY (no pow); momentum_i = round4(score_i + momentum_{i-1} * decay)
    with momentum_{-1}=0; negative/equal deltas clamp windows to 0. This must match
    spec/conformance/risk-episode-rollup.json.

    When rollup.frequencyRules is non-empty the episode score becomes
    clamp01(round4(max(peak, velocityScore, frequencyScore))) and frequencyScore/
    frequencyMatches are emitted. A missing or empty frequencyRules key takes literally
    the pre-frequency code path and emits NO frequency keys, keeping older policies and
    hash anchors byte-stable (spec/conformance/risk-episode-frequency.json).
    """
    rollup = policy["rollup"]
    window_ms = rollup["windowSeconds"] * 1000
    decay_per_window = rollup["decayPerWindow"]
    velocity_normalizer = rollup["velocityNormalizer"]
    frequency_rules = rollup.get("frequencyRules", [])
    _assert_frequency_rules(frequency_rules)
    ordered = sorted(steps, key=lambda step: _occurred_at_ms(step["occurredAt"]))
    peak = 0.0
    momentum = 0.0
    max_momentum = 0.0
    previous_ms: int | None = None
    for step in ordered:
        score = step["score"]
        if score > peak:
            peak = score
        current_ms = _occurred_at_ms(step["occurredAt"])
        if previous_ms is None:
            decayed = 0.0
        else:
            delta_ms = current_ms - previous_ms
            windows = math.floor(max(0, delta_ms) / window_ms)
            decay = 1.0
            for _ in range(windows):
                decay *= decay_per_window
            decayed = momentum * decay
        momentum = round4(score + decayed)
        if momentum > max_momentum:
            max_momentum = momentum
        previous_ms = current_ms
    velocity_score = clamp01(round4(max_momentum / velocity_normalizer))
    if len(frequency_rules) > 0:
        frequency_score, frequency_matches = _evaluate_frequency_rules(ordered, frequency_rules)
        rollup_score = clamp01(round4(max(peak, velocity_score, frequency_score)))
        return {
            "score": rollup_score,
            "level": band_of(rollup_score, policy["bands"]),
            "peak": peak,
            "velocityScore": velocity_score,
            "stepCount": len(ordered),
            "policyVersion": policy["policyVersion"],
            "frequencyScore": frequency_score,
            "frequencyMatches": frequency_matches,
        }
    rollup_score = clamp01(round4(max(peak, velocity_score)))
    return {
        "score": rollup_score,
        "level": band_of(rollup_score, policy["bands"]),
        "peak": peak,
        "velocityScore": velocity_score,
        "stepCount": len(ordered),
        "policyVersion": policy["policyVersion"],
    }


def create_security_risk_assertion(input_assertion: dict[str, Any]) -> dict[str, Any]:
    """Build a SecurityRiskAssertion record (recordType 'assertion.recorded') from a scored conclusion.

    Mirrors sdks/typescript/src/risk.ts createSecurityRiskAssertion exactly: the
    producer authority is fixed to 'veritio.detectors', the raw idempotency key is
    tenant-scoped hashed (never stored raw) via hash_idempotency_key, and only the
    documented fields ride into the canonical hash. Fails closed without a tenant
    scope, producer, idempotency key, or a fully-qualified subject EvidenceRef so the
    assertion can never be appended without the integrity fields readers need.
    """
    scope = input_assertion["scope"]
    _assert_non_empty(scope.get("tenantId"), "scope.tenantId")
    _assert_non_empty(input_assertion.get("producerId"), "producerId")
    _assert_non_empty(input_assertion.get("idempotencyKey"), "idempotencyKey")
    subject = input_assertion["subject"]
    _assert_ref(subject)
    conclusion = input_assertion["conclusion"]
    if conclusion["assessment"] not in ("step", "episode_rollup"):
        raise TypeError("conclusion.assessment must be 'step' or 'episode_rollup'")
    _assert_conclusion(conclusion)
    return {
        "recordType": "assertion.recorded",
        "schemaVersion": "2026-06-23",
        "recordAuthority": "veritio",
        "id": input_assertion.get("id") or f"asr_{uuid.uuid4()}",
        "type": "security.risk",
        "scope": _clean_scope(scope),
        "occurredAt": _normalize_datetime(input_assertion.get("occurredAt") or datetime.now(timezone.utc)),
        "producer": {
            "authority": "veritio.detectors",
            "kind": "principal",
            "type": "service",
            "id": input_assertion["producerId"],
        },
        "idempotencyKeyHash": hash_idempotency_key(scope["tenantId"], input_assertion["idempotencyKey"]),
        "subject": {"authority": subject["authority"], "kind": subject["kind"], "type": subject["type"], "id": subject["id"]},
        "conclusion": {
            "score": conclusion["score"],
            "level": conclusion["level"],
            "policyVersion": conclusion["policyVersion"],
            "assessment": conclusion["assessment"],
        },
        "factors": [
            {
                "key": factor["key"],
                "value": factor["value"],
                "kind": factor["kind"],
                "weight": factor["weight"],
                "contribution": factor["contribution"],
            }
            for factor in input_assertion["factors"]
        ],
    }


def hash_assertion_record(assertion: dict[str, Any]) -> str:
    """Recompute a SecurityRiskAssertion envelope hash over canonical JSON, excluding any stored hash.

    Mirrors hash_audit_record so an assertion appended to an EvidenceCommit can be
    independently re-verified by any SDK.
    """
    payload = {key: value for key, value in assertion.items() if key != "hash"}
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def build_security_risk_assessed_event(input_event: dict[str, Any]) -> dict[str, Any]:
    """Build an AuditEventInput (action 'security.risk.assessed') threaded to an episode via activityEpisodeId.

    Mirrors sdks/typescript/src/risk.ts buildSecurityRiskAssessedEvent: the subject
    becomes the event target, the producer becomes a service actor, the conclusion
    (and optional normalized signals) ride in metadata.riskAssessment / riskSignals,
    and activityEpisodeId is stamped via merge_veritio_metadata AFTER caller metadata
    so a caller passing activityEpisodeId fails closed instead of spoofing the chain.
    Returns an AuditEventInput; the host recorder runs create_audit_event later.
    """
    scope = input_event["scope"]
    _assert_non_empty(scope.get("tenantId"), "scope.tenantId")
    _assert_non_empty(input_event.get("producerId"), "producerId")
    subject = input_event["subject"]
    _assert_ref(subject)
    conclusion = input_event["conclusion"]
    _assert_conclusion(conclusion)
    risk_signals = input_event.get("riskSignals")
    if risk_signals is not None:
        base_metadata = with_risk_signals(input_event.get("metadata"), risk_signals)
    else:
        base_metadata = {**(input_event.get("metadata") or {})}
    risk_assessment: dict[str, Any] = {
        "score": conclusion["score"],
        "level": conclusion["level"],
        "policyVersion": conclusion["policyVersion"],
        "assessment": conclusion["assessment"],
    }
    if input_event.get("factors") is not None:
        risk_assessment["factors"] = input_event["factors"]
    base_metadata["riskAssessment"] = risk_assessment
    metadata = merge_veritio_metadata(
        base_metadata,
        {"activityEpisodeId": input_event.get("activityEpisodeId")},
    )
    event: dict[str, Any] = {
        "scope": scope,
        "actor": input_event.get("actor") or {"type": "service", "id": input_event["producerId"]},
        "action": "security.risk.assessed",
        "target": {"type": subject["type"], "id": subject["id"]},
        "metadata": metadata,
    }
    if input_event.get("occurredAt") is not None:
        event["occurredAt"] = input_event["occurredAt"]
    return event


# Temperature-derived policies live in ./risk_policy (crypto-free, needs only this
# module's DEFAULT_RISK_POLICY + round4) and are re-exported here so the public surface
# stays single-import: `from veritio.risk import risk_policy` keeps working. This mirrors
# the TS split where risk-score.ts ends with `export * from "./risk-policy.js"`. The
# import cycle is benign: it runs at this module's tail, after DEFAULT_RISK_POLICY and
# round4 are already defined, so risk_policy.py resolves them without a partial-init error.
from .risk_policy import risk_policy  # noqa: E402
