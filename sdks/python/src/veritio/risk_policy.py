"""Temperature-derived risk policies for the Veritio evidence layer.

This module mirrors sdks/typescript/src/risk-policy.ts, the sibling that TS split
out of risk-score.ts; here risk.py plays the risk-score.ts role and this file plays
risk-policy.ts. Like risk.py it is language-neutral protocol math (the Go port in
sdks/go/risk_policy.go must stay byte-identical) and CRYPTO-FREE: derivation uses ONLY
two-segment linear interpolation + round4 (never pow/exp/log). The endpoint constants
below are pinned by spec/conformance/risk-policy-temperature.json.

risk.py re-exports risk_policy at its module tail (mirroring TS `export * from
"./risk-policy.js"`), so the public surface is unchanged: `from veritio.risk import
risk_policy` and `from veritio import risk_policy` both work. The resulting import
cycle (risk.py -> risk_policy.py -> risk.py) is benign because this module only needs
DEFAULT_RISK_POLICY and round4, both defined near the top of risk.py before its tail
re-export runs.
"""

from __future__ import annotations

import math
from typing import Any

from .risk import DEFAULT_RISK_POLICY, round4

# Pinned lenient(t=0)/reference(t=0.5)/strict(t=1) endpoints for every temperature-scaled
# field, mirroring sdks/typescript/src/risk-policy.ts TEMPERATURE_ENDPOINTS. These numbers
# are a cross-language protocol contract pinned by spec/conformance/risk-policy-temperature.json;
# changing any must update TypeScript, Go, and the fixture together.
TEMPERATURE_ENDPOINTS: dict[str, dict[str, float]] = {
    "bandsLow": {"lenient": 0.1, "reference": 0.05, "strict": 0.02},
    "bandsMedium": {"lenient": 0.35, "reference": 0.25, "strict": 0.18},
    "bandsHigh": {"lenient": 0.6, "reference": 0.5, "strict": 0.4},
    "bandsCritical": {"lenient": 0.85, "reference": 0.75, "strict": 0.65},
    "decayPerWindow": {"lenient": 0.3, "reference": 0.5, "strict": 0.7},
    "velocityNormalizer": {"lenient": 4.0, "reference": 3.0, "strict": 2.0},
    "maxBoost": {"lenient": 0.25, "reference": 0.4, "strict": 0.6},
    "irreversibleFactor": {"lenient": 1.15, "reference": 1.3, "strict": 1.6},
    "productionFactor": {"lenient": 0.9, "reference": 1.0, "strict": 1.2},
}


def _lerp_temperature(endpoint: dict[str, float], t: float) -> float:
    """Two-segment lerp between lenient/reference/strict so t=0.5 lands exactly on reference.

    round4 on the result keeps TS/Python/Go byte-identical; uses only multiply/divide
    (no pow/exp) exactly like risk-policy.ts lerpTemperature.
    """
    if t <= 0.5:
        return round4(endpoint["lenient"] + (endpoint["reference"] - endpoint["lenient"]) * (t / 0.5))
    return round4(endpoint["reference"] + (endpoint["strict"] - endpoint["reference"]) * ((t - 0.5) / 0.5))


def _temperature_hundredths(temperature: Any) -> int:
    """Validate temperature fail-closed and convert to integer hundredths (the only version representation).

    Rejects bool, non-finite, out-of-[0,1], and anything not a multiple of 0.01 (via the
    same 1e-9 tolerance as risk-policy.ts temperatureHundredths) so float formatting can
    never diverge across languages.
    """
    if (
        isinstance(temperature, bool)
        or not isinstance(temperature, (int, float))
        or not math.isfinite(temperature)
        or temperature < 0
        or temperature > 1
    ):
        raise TypeError("temperature must be a finite number in [0,1]")
    hundredths = round(temperature * 100)
    if abs(temperature * 100 - hundredths) > 1e-9:
        raise TypeError("temperature must be a multiple of 0.01")
    return hundredths


def _temperature_version(hundredths: int) -> str:
    """Build the derived policyVersion suffix from integer hundredths only (never float formatting).

    70 -> "veritio.reference.v1+temp0.70". Integer division/modulo plus zero-padding is
    byte-identical across TS/Python/Go (risk-policy.ts temperatureVersion).
    """
    whole = hundredths // 100
    frac = hundredths % 100
    padded = f"0{frac}" if frac < 10 else f"{frac}"
    return f"{DEFAULT_RISK_POLICY['policyVersion']}+temp{whole}.{padded}"


def _assert_derived_policy(policy: dict[str, Any]) -> None:
    """Fail-closed structural check on the final policy after derivation and overrides.

    Every numeric leaf must be finite, bands strictly ascending, multiplier factors > 0,
    windowSeconds/velocityNormalizer > 0, and policyVersion a non-empty string. Guards a
    future endpoint retune or a caller override from producing a policy the banding math
    cannot honor (risk-policy.ts assertDerivedPolicy). bool is rejected as a numeric leaf.
    """
    numeric_leaves = [
        *policy["operationBase"].values(),
        *policy["reversibilityFactor"].values(),
        *policy["envCriticalityFactor"].values(),
        policy["magnitude"]["maxBoost"],
        *policy["magnitude"]["weights"].values(),
        *policy["magnitude"]["k"].values(),
        *policy["bands"].values(),
        policy["rollup"]["windowSeconds"],
        policy["rollup"]["decayPerWindow"],
        policy["rollup"]["velocityNormalizer"],
    ]
    if any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
        for value in numeric_leaves
    ):
        raise TypeError("policy numeric fields must all be finite numbers")
    bands = policy["bands"]
    if not (bands["low"] < bands["medium"] < bands["high"] < bands["critical"]):
        raise TypeError("policy bands must be strictly ascending")
    factors = [*policy["reversibilityFactor"].values(), *policy["envCriticalityFactor"].values()]
    if any(value <= 0 for value in factors):
        raise TypeError("policy multiplier factors must be greater than 0")
    if policy["rollup"]["windowSeconds"] <= 0 or policy["rollup"]["velocityNormalizer"] <= 0:
        raise TypeError("policy rollup windowSeconds and velocityNormalizer must be greater than 0")
    if not isinstance(policy["policyVersion"], str) or len(policy["policyVersion"]) == 0:
        raise TypeError("policy policyVersion must be a non-empty string")


def _merge_overrides(base: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    """Explicit deep-merge of overrides into a derived policy (risk-policy.ts mergeOverrides).

    overrides.policyVersion is MANDATORY so a hand-tuned policy is never misrepresented by
    an auto temperature suffix. Only documented sub-objects merge (one level into
    operationBase/factors/bands/rollup, two into magnitude.weights/k); frequencyRules
    replaces wholesale. Enumerating known keys keeps unknown keys out of the policy shape.
    """
    policy_version = overrides.get("policyVersion")
    if not isinstance(policy_version, str) or len(policy_version) == 0:
        raise TypeError(
            "overrides.policyVersion is required when overriding policy fields so a hand-tuned "
            "policy is never misrepresented by a temperature version"
        )
    magnitude = overrides.get("magnitude") or {}
    rollup = overrides.get("rollup") or {}
    max_boost = magnitude.get("maxBoost")
    window_seconds = rollup.get("windowSeconds")
    decay_per_window = rollup.get("decayPerWindow")
    velocity_normalizer = rollup.get("velocityNormalizer")
    frequency_rules = rollup.get("frequencyRules")
    return {
        "policyVersion": policy_version,
        "operationBase": {**base["operationBase"], **(overrides.get("operationBase") or {})},
        "reversibilityFactor": {**base["reversibilityFactor"], **(overrides.get("reversibilityFactor") or {})},
        "envCriticalityFactor": {**base["envCriticalityFactor"], **(overrides.get("envCriticalityFactor") or {})},
        "magnitude": {
            "maxBoost": base["magnitude"]["maxBoost"] if max_boost is None else max_boost,
            "weights": {**base["magnitude"]["weights"], **(magnitude.get("weights") or {})},
            "k": {**base["magnitude"]["k"], **(magnitude.get("k") or {})},
        },
        "bands": {**base["bands"], **(overrides.get("bands") or {})},
        "rollup": {
            "windowSeconds": base["rollup"]["windowSeconds"] if window_seconds is None else window_seconds,
            "decayPerWindow": base["rollup"]["decayPerWindow"] if decay_per_window is None else decay_per_window,
            "velocityNormalizer": base["rollup"]["velocityNormalizer"]
            if velocity_normalizer is None
            else velocity_normalizer,
            "frequencyRules": base["rollup"]["frequencyRules"] if frequency_rules is None else frequency_rules,
        },
    }


def risk_policy(options: dict[str, Any] | None = None) -> dict[str, Any]:
    """Derive a full RiskScoringPolicy from DEFAULT_RISK_POLICY (risk-policy.ts riskPolicy).

    ``temperature`` (a multiple of 0.01 in [0,1]; 0.5 reproduces the reference policy
    byte-for-byte, lower = lenient, higher = strict) rescales only the pinned
    TEMPERATURE_ENDPOINTS fields and stamps a deterministic "veritio.reference.v1+tempX.XX"
    policyVersion. ``overrides`` deep-merge AFTER derivation and require an explicit
    overrides.policyVersion (fail closed). No options returns a fresh copy equal to
    DEFAULT_RISK_POLICY. Never mutates DEFAULT_RISK_POLICY; pure and deterministic so
    TS/Python/Go derive byte-identical policies (spec/conformance/risk-policy-temperature.json).
    """
    options = options or {}
    derived: dict[str, Any] = {
        "policyVersion": DEFAULT_RISK_POLICY["policyVersion"],
        "operationBase": {**DEFAULT_RISK_POLICY["operationBase"]},
        "reversibilityFactor": {**DEFAULT_RISK_POLICY["reversibilityFactor"]},
        "envCriticalityFactor": {**DEFAULT_RISK_POLICY["envCriticalityFactor"]},
        "magnitude": {
            "maxBoost": DEFAULT_RISK_POLICY["magnitude"]["maxBoost"],
            "weights": {**DEFAULT_RISK_POLICY["magnitude"]["weights"]},
            "k": {**DEFAULT_RISK_POLICY["magnitude"]["k"]},
        },
        "bands": {**DEFAULT_RISK_POLICY["bands"]},
        "rollup": {
            **DEFAULT_RISK_POLICY["rollup"],
            "frequencyRules": [*DEFAULT_RISK_POLICY["rollup"]["frequencyRules"]],
        },
    }
    temperature = options.get("temperature")
    if temperature is not None:
        hundredths = _temperature_hundredths(temperature)
        derived["policyVersion"] = _temperature_version(hundredths)
        derived["bands"] = {
            "low": _lerp_temperature(TEMPERATURE_ENDPOINTS["bandsLow"], temperature),
            "medium": _lerp_temperature(TEMPERATURE_ENDPOINTS["bandsMedium"], temperature),
            "high": _lerp_temperature(TEMPERATURE_ENDPOINTS["bandsHigh"], temperature),
            "critical": _lerp_temperature(TEMPERATURE_ENDPOINTS["bandsCritical"], temperature),
        }
        derived["rollup"]["decayPerWindow"] = _lerp_temperature(TEMPERATURE_ENDPOINTS["decayPerWindow"], temperature)
        derived["rollup"]["velocityNormalizer"] = _lerp_temperature(
            TEMPERATURE_ENDPOINTS["velocityNormalizer"], temperature
        )
        derived["magnitude"]["maxBoost"] = _lerp_temperature(TEMPERATURE_ENDPOINTS["maxBoost"], temperature)
        derived["reversibilityFactor"]["irreversible"] = _lerp_temperature(
            TEMPERATURE_ENDPOINTS["irreversibleFactor"], temperature
        )
        derived["envCriticalityFactor"]["production"] = _lerp_temperature(
            TEMPERATURE_ENDPOINTS["productionFactor"], temperature
        )
    overrides = options.get("overrides")
    if overrides is not None and len(overrides) > 0:
        derived = _merge_overrides(derived, overrides)
    _assert_derived_policy(derived)
    return derived
