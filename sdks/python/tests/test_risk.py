import copy
import json
import unittest
from pathlib import Path

from veritio.event import create_audit_event, hash_audit_event, hash_idempotency_key
from veritio.risk import (
    DEFAULT_RISK_POLICY,
    band_of,
    build_security_risk_assessed_event,
    clamp01,
    create_security_risk_assertion,
    hash_assertion_record,
    normalize_risk_signals,
    risk_policy,
    rollup_episode_risk,
    round4,
    score_risk_signals,
    with_risk_signals,
)

CONFORMANCE_DIR = Path(__file__).resolve().parents[3] / "spec" / "conformance"


def load_risk_fixture(file_name):
    return json.loads((CONFORMANCE_DIR / file_name).read_text(encoding="utf-8"))


class RiskPrimitivesTests(unittest.TestCase):
    def test_round4_is_integer_half_up(self):
        self.assertEqual(round4(0.05), 0.05)
        self.assertEqual(round4(0.20), 0.2)
        self.assertEqual(round4(1.0 / 3.0), 0.3333)
        self.assertEqual(round4(0.06666666), 0.0667)
        self.assertEqual(round4(1.04), 1.04)

    def test_clamp01_bounds(self):
        self.assertEqual(clamp01(1.04), 1.0)
        self.assertEqual(clamp01(-0.2), 0.0)
        self.assertEqual(clamp01(0.5), 0.5)

    def test_band_of_uses_strict_lower_edges(self):
        bands = DEFAULT_RISK_POLICY["bands"]
        self.assertEqual(band_of(0.0, bands), "none")
        self.assertEqual(band_of(0.049, bands), "none")
        self.assertEqual(band_of(0.05, bands), "low")
        self.assertEqual(band_of(0.25, bands), "medium")
        self.assertEqual(band_of(0.5, bands), "high")
        self.assertEqual(band_of(0.75, bands), "critical")
        self.assertEqual(band_of(1.0, bands), "critical")

    def test_default_policy_constants(self):
        self.assertEqual(DEFAULT_RISK_POLICY["policyVersion"], "veritio.reference.v1")
        self.assertEqual(DEFAULT_RISK_POLICY["operationBase"]["read"], 0.05)
        self.assertEqual(DEFAULT_RISK_POLICY["operationBase"]["destructive"], 0.85)
        self.assertEqual(DEFAULT_RISK_POLICY["reversibilityFactor"]["irreversible"], 1.3)
        self.assertEqual(DEFAULT_RISK_POLICY["envCriticalityFactor"]["production"], 1.0)
        self.assertEqual(DEFAULT_RISK_POLICY["magnitude"]["maxBoost"], 0.40)
        self.assertEqual(DEFAULT_RISK_POLICY["magnitude"]["weights"], {"dataVolume": 0.5, "fanOut": 0.3, "referenceCount": 0.2})
        self.assertEqual(DEFAULT_RISK_POLICY["magnitude"]["k"], {"dataVolume": 100, "fanOut": 25, "referenceCount": 50})
        self.assertEqual(DEFAULT_RISK_POLICY["bands"], {"low": 0.05, "medium": 0.25, "high": 0.50, "critical": 0.75})
        self.assertEqual(
            DEFAULT_RISK_POLICY["rollup"],
            {"windowSeconds": 60, "decayPerWindow": 0.5, "velocityNormalizer": 3.0, "frequencyRules": []},
        )


class NormalizeRiskSignalsTests(unittest.TestCase):
    def test_defaults_recoverable_production_zero_magnitudes(self):
        self.assertEqual(
            normalize_risk_signals({"operationType": "update"}),
            {
                "operationType": "update",
                "reversibility": "recoverable",
                "envCriticality": "production",
                "dataVolume": 0,
                "fanOut": 0,
                "referenceCount": 0,
            },
        )

    def test_preserves_supplied_values(self):
        self.assertEqual(
            normalize_risk_signals(
                {
                    "operationType": "delete",
                    "reversibility": "irreversible",
                    "envCriticality": "staging",
                    "dataVolume": 200,
                    "fanOut": 50,
                    "referenceCount": 100,
                }
            ),
            {
                "operationType": "delete",
                "reversibility": "irreversible",
                "envCriticality": "staging",
                "dataVolume": 200,
                "fanOut": 50,
                "referenceCount": 100,
            },
        )

    def test_fails_closed_on_unknown_enum(self):
        with self.assertRaisesRegex(TypeError, "operationType"):
            normalize_risk_signals({"operationType": "purge"})
        with self.assertRaisesRegex(TypeError, "reversibility"):
            normalize_risk_signals({"operationType": "read", "reversibility": "maybe"})
        with self.assertRaisesRegex(TypeError, "envCriticality"):
            normalize_risk_signals({"operationType": "read", "envCriticality": "prod"})

    def test_fails_closed_on_negative_or_non_integer_magnitudes(self):
        with self.assertRaisesRegex(TypeError, "dataVolume"):
            normalize_risk_signals({"operationType": "read", "dataVolume": -1})
        with self.assertRaisesRegex(TypeError, "fanOut"):
            normalize_risk_signals({"operationType": "read", "fanOut": 1.5})
        with self.assertRaisesRegex(TypeError, "referenceCount"):
            normalize_risk_signals({"operationType": "read", "referenceCount": True})
        with self.assertRaisesRegex(TypeError, "dataVolume"):
            normalize_risk_signals({"operationType": "read", "dataVolume": float("nan")})
        with self.assertRaisesRegex(TypeError, "fanOut"):
            normalize_risk_signals({"operationType": "read", "fanOut": float("inf")})

    def test_accepts_integer_valued_float_magnitudes_matching_ts_and_go(self):
        # TS Number.isInteger(100.0)===true and Go 100.0==Floor(100.0) accept whole
        # floats, so Python must coerce them to int 100 and score identically.
        normalized = normalize_risk_signals(
            {"operationType": "read", "dataVolume": 100.0, "fanOut": 25.0, "referenceCount": 50.0}
        )
        self.assertEqual(normalized["dataVolume"], 100)
        self.assertIsInstance(normalized["dataVolume"], int)
        self.assertEqual(normalized["fanOut"], 25)
        self.assertEqual(normalized["referenceCount"], 50)
        self.assertEqual(
            score_risk_signals({"operationType": "read", "dataVolume": 100.0}),
            score_risk_signals({"operationType": "read", "dataVolume": 100}),
        )

    def test_with_risk_signals_stamps_normalized_after_caller_metadata(self):
        self.assertEqual(
            with_risk_signals({"note": "x"}, {"operationType": "create", "dataVolume": 10}),
            {
                "note": "x",
                "riskSignals": {
                    "operationType": "create",
                    "reversibility": "recoverable",
                    "envCriticality": "production",
                    "dataVolume": 10,
                    "fanOut": 0,
                    "referenceCount": 0,
                },
            },
        )
        self.assertEqual(
            with_risk_signals(None, {"operationType": "read"})["riskSignals"]["operationType"],
            "read",
        )


class ScoreRiskSignalsTests(unittest.TestCase):
    def test_read_default_is_low(self):
        result = score_risk_signals({"operationType": "read"})
        self.assertEqual(result["score"], 0.05)
        self.assertEqual(result["level"], "low")
        self.assertEqual(result["policyVersion"], "veritio.reference.v1")

    def test_config_default_is_medium(self):
        result = score_risk_signals({"operationType": "config"})
        self.assertEqual(result["score"], 0.45)
        self.assertEqual(result["level"], "medium")

    def test_destructive_delete_clamps_to_critical(self):
        result = score_risk_signals(
            {"operationType": "delete", "reversibility": "irreversible", "envCriticality": "production", "dataVolume": 100}
        )
        self.assertEqual(result["score"], 1.0)
        self.assertEqual(result["level"], "critical")

    def test_additive_factors_breakdown(self):
        # Factor keys mirror the TS source of truth and risk-scoring-default-policy.json:
        # operationType/dataVolume/fanOut/referenceCount/reversibility/envCriticality, base weight == 1.
        result = score_risk_signals(
            {
                "operationType": "update",
                "reversibility": "reversible",
                "envCriticality": "staging",
                "dataVolume": 50,
                "fanOut": 10,
                "referenceCount": 25,
            }
        )
        self.assertEqual(result["score"], 0.2053)
        self.assertEqual(result["level"], "low")
        contributions = {factor["key"]: factor["contribution"] for factor in result["factors"]}
        self.assertEqual(contributions["operationType"], 0.30)
        self.assertEqual(contributions["dataVolume"], 0.0667)
        self.assertEqual(contributions["fanOut"], 0.0343)
        self.assertEqual(contributions["referenceCount"], 0.0267)
        self.assertEqual(contributions["reversibility"], 0.6)
        self.assertEqual(contributions["envCriticality"], 0.8)
        self.assertEqual([factor["kind"] for factor in result["factors"]], ["base", "additive", "additive", "additive", "multiplier", "multiplier"])
        base_factor = result["factors"][0]
        self.assertEqual(base_factor["key"], "operationType")
        self.assertEqual(base_factor["weight"], 1)


class RollupEpisodeRiskTests(unittest.TestCase):
    def test_two_steps_within_one_window(self):
        result = rollup_episode_risk(
            [
                {"occurredAt": "2026-06-23T10:00:00.000Z", "score": 0.5},
                {"occurredAt": "2026-06-23T10:00:30.000Z", "score": 0.5},
            ]
        )
        self.assertEqual(
            result,
            {
                "score": 0.5,
                "level": "high",
                "peak": 0.5,
                "velocityScore": 0.3333,
                "stepCount": 2,
                "policyVersion": "veritio.reference.v1",
            },
        )

    def test_decay_applies_per_integer_window(self):
        result = rollup_episode_risk(
            [
                {"occurredAt": "2026-06-23T10:00:00.000Z", "score": 0.5},
                {"occurredAt": "2026-06-23T10:02:00.000Z", "score": 0.5},
            ]
        )
        self.assertEqual(result["velocityScore"], 0.2083)
        self.assertEqual(result["score"], 0.5)
        self.assertEqual(result["peak"], 0.5)

    def test_steps_are_sorted_by_occurred_at(self):
        forward = rollup_episode_risk(
            [
                {"occurredAt": "2026-06-23T10:00:00.000Z", "score": 0.5},
                {"occurredAt": "2026-06-23T10:00:30.000Z", "score": 0.5},
            ]
        )
        reversed_input = rollup_episode_risk(
            [
                {"occurredAt": "2026-06-23T10:00:30.000Z", "score": 0.5},
                {"occurredAt": "2026-06-23T10:00:00.000Z", "score": 0.5},
            ]
        )
        self.assertEqual(forward, reversed_input)

    def test_empty_episode_rolls_up_to_none(self):
        self.assertEqual(
            rollup_episode_risk([]),
            {
                "score": 0,
                "level": "none",
                "peak": 0,
                "velocityScore": 0,
                "stepCount": 0,
                "policyVersion": "veritio.reference.v1",
            },
        )


# The assertion builder takes the RAW idempotencyKey and tenant-scope hashes it
# (mirrors TS createSecurityRiskAssertion); idempotencyKeyHash is derived, not supplied.
ASSERTION_INPUT = {
    "id": "asrt_risk_001",
    "scope": {"tenantId": "org_123", "environment": "production"},
    "occurredAt": "2026-06-23T10:00:00.000Z",
    "producerId": "svc_risk_detector",
    "idempotencyKey": "risk:chg_001:step",
    "subject": {"authority": "veritio", "kind": "change", "type": "db.write", "id": "chg_001"},
    "conclusion": {"score": 1.0, "level": "critical", "policyVersion": "veritio.reference.v1", "assessment": "step"},
    "factors": [
        {"key": "operationType", "value": "delete", "kind": "base", "weight": 1, "contribution": 0.7},
        {"key": "reversibility", "value": "irreversible", "kind": "multiplier", "weight": 1.3, "contribution": 1.3},
        {"key": "envCriticality", "value": "production", "kind": "multiplier", "weight": 1, "contribution": 1},
    ],
}

EXPECTED_ASSERTION = {
    "recordType": "assertion.recorded",
    "schemaVersion": "2026-06-23",
    "recordAuthority": "veritio",
    "id": "asrt_risk_001",
    "type": "security.risk",
    "scope": {"tenantId": "org_123", "environment": "production"},
    "occurredAt": "2026-06-23T10:00:00.000Z",
    "producer": {"authority": "veritio.detectors", "kind": "principal", "type": "service", "id": "svc_risk_detector"},
    "idempotencyKeyHash": hash_idempotency_key("org_123", "risk:chg_001:step"),
    "subject": {"authority": "veritio", "kind": "change", "type": "db.write", "id": "chg_001"},
    "conclusion": {"score": 1.0, "level": "critical", "policyVersion": "veritio.reference.v1", "assessment": "step"},
    "factors": ASSERTION_INPUT["factors"],
}


class SecurityRiskAssertionTests(unittest.TestCase):
    def test_create_security_risk_assertion_shape(self):
        self.assertEqual(create_security_risk_assertion(ASSERTION_INPUT), EXPECTED_ASSERTION)

    def test_create_security_risk_assertion_drops_absent_scope_fields(self):
        assertion = create_security_risk_assertion({**ASSERTION_INPUT, "scope": {"tenantId": "org_123"}})
        self.assertEqual(assertion["scope"], {"tenantId": "org_123"})

    def test_create_security_risk_assertion_requires_tenant_and_subject(self):
        with self.assertRaisesRegex(TypeError, "scope.tenantId"):
            create_security_risk_assertion({**ASSERTION_INPUT, "scope": {"environment": "production"}})
        with self.assertRaisesRegex(TypeError, "ref."):
            create_security_risk_assertion({**ASSERTION_INPUT, "subject": {"authority": "veritio", "kind": "change", "type": "db.write"}})

    def test_create_security_risk_assertion_requires_producer_and_idempotency_key(self):
        with self.assertRaisesRegex(TypeError, "producerId"):
            create_security_risk_assertion({**ASSERTION_INPUT, "producerId": ""})
        with self.assertRaisesRegex(TypeError, "idempotencyKey"):
            create_security_risk_assertion({**ASSERTION_INPUT, "idempotencyKey": ""})

    def test_create_security_risk_assertion_rejects_unknown_assessment(self):
        with self.assertRaisesRegex(TypeError, "assessment"):
            create_security_risk_assertion(
                {**ASSERTION_INPUT, "conclusion": {**ASSERTION_INPUT["conclusion"], "assessment": "guess"}}
            )

    def test_create_security_risk_assertion_rejects_out_of_range_score_or_level(self):
        with self.assertRaisesRegex(TypeError, "conclusion.score"):
            create_security_risk_assertion(
                {**ASSERTION_INPUT, "conclusion": {**ASSERTION_INPUT["conclusion"], "score": 1.5}}
            )
        with self.assertRaisesRegex(TypeError, "conclusion.score"):
            create_security_risk_assertion(
                {**ASSERTION_INPUT, "conclusion": {**ASSERTION_INPUT["conclusion"], "score": float("nan")}}
            )
        with self.assertRaisesRegex(TypeError, "conclusion.level"):
            create_security_risk_assertion(
                {**ASSERTION_INPUT, "conclusion": {**ASSERTION_INPUT["conclusion"], "level": "extreme"}}
            )

    def test_hash_assertion_record_excludes_stored_hash(self):
        assertion = create_security_risk_assertion(ASSERTION_INPUT)
        digest = hash_assertion_record(assertion)
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        self.assertEqual(hash_assertion_record({**assertion, "hash": "ignored"}), digest)


class BuildSecurityRiskAssessedEventTests(unittest.TestCase):
    def _input(self):
        return {
            "scope": {"tenantId": "org_123", "environment": "production"},
            "occurredAt": "2026-06-23T10:00:00.000Z",
            "producerId": "svc_risk_detector",
            "subject": {"authority": "veritio", "kind": "change", "type": "db.write", "id": "chg_001"},
            "conclusion": {"score": 1.0, "level": "critical", "policyVersion": "veritio.reference.v1", "assessment": "step"},
            "activityEpisodeId": "ep_1",
        }

    def test_action_target_and_episode_threading(self):
        # metadata key is riskAssessment (mirrors TS buildSecurityRiskAssessedEvent); actor
        # defaults to a bare service principal and occurredAt is forwarded raw for createAuditEvent.
        event = build_security_risk_assessed_event({**self._input(), "metadata": {"note": "x"}})
        self.assertEqual(event["action"], "security.risk.assessed")
        self.assertEqual(event["target"], {"type": "db.write", "id": "chg_001"})
        self.assertEqual(event["scope"], {"tenantId": "org_123", "environment": "production"})
        self.assertEqual(event["actor"], {"type": "service", "id": "svc_risk_detector"})
        self.assertEqual(event["metadata"]["activityEpisodeId"], "ep_1")
        self.assertEqual(event["metadata"]["note"], "x")
        self.assertEqual(event["metadata"]["riskAssessment"]["level"], "critical")
        self.assertEqual(event["occurredAt"], "2026-06-23T10:00:00.000Z")

    def test_caller_cannot_shadow_activity_episode_id(self):
        with self.assertRaisesRegex(TypeError, "activityEpisodeId is reserved by Veritio"):
            build_security_risk_assessed_event({**self._input(), "metadata": {"activityEpisodeId": "spoof"}})

    def test_rejects_out_of_range_score_or_unknown_level(self):
        with self.assertRaisesRegex(TypeError, "conclusion.score"):
            build_security_risk_assessed_event(
                {**self._input(), "conclusion": {**self._input()["conclusion"], "score": 1.5}}
            )
        with self.assertRaisesRegex(TypeError, "conclusion.level"):
            build_security_risk_assessed_event(
                {**self._input(), "conclusion": {**self._input()["conclusion"], "level": "extreme"}}
            )


class PackageExportsTests(unittest.TestCase):
    def test_risk_surface_is_exported_from_package_root(self):
        import veritio

        for name in (
            "DEFAULT_RISK_POLICY",
            "band_of",
            "build_security_risk_assessed_event",
            "create_security_risk_assertion",
            "hash_assertion_record",
            "normalize_risk_signals",
            "risk_policy",
            "rollup_episode_risk",
            "score_risk_signals",
            "with_risk_signals",
        ):
            with self.subTest(name=name):
                self.assertIn(name, veritio.__all__)
                self.assertTrue(hasattr(veritio, name))


class RiskConformanceParityTests(unittest.TestCase):
    """Cross-language anchor: load the TS-authored fixtures and match byte-for-byte.

    Fixture key names follow the authored fixtures (normalization uses input/normalized/
    expectError; scoring uses signals/expected; rollup uses steps/expected; assertion uses
    input/expected; hashing uses assertion/expectedHash). Doc-only keys such as breakdown
    and momentumTrace are not asserted.
    """

    def test_normalization_matches_fixture(self):
        fixture = load_risk_fixture("risk-signals-normalization.json")
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                if case.get("expectError"):
                    with self.assertRaises(TypeError):
                        normalize_risk_signals(case["input"])
                else:
                    self.assertEqual(normalize_risk_signals(case["input"]), case["normalized"])

    def test_scoring_matches_fixture(self):
        fixture = load_risk_fixture("risk-scoring-default-policy.json")
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(score_risk_signals(case["signals"]), case["expected"])

    def test_rollup_matches_fixture(self):
        fixture = load_risk_fixture("risk-episode-rollup.json")
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(rollup_episode_risk(case["steps"]), case["expected"])

    def test_assertion_matches_fixture(self):
        fixture = load_risk_fixture("security-risk-assertion.json")
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(create_security_risk_assertion(case["input"]), case["expected"])

    def test_assertion_hashing_matches_fixture(self):
        fixture = load_risk_fixture("assertion-hashing.json")
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(hash_assertion_record(case["assertion"]), case["expectedHash"])

    def test_policy_temperature_matches_fixture(self):
        fixture = load_risk_fixture("risk-policy-temperature.json")
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                if case.get("expectError"):
                    with self.assertRaises(TypeError):
                        risk_policy(case["options"])
                else:
                    self.assertEqual(risk_policy(case["options"]), case["expectedPolicy"])

    def test_episode_frequency_matches_fixture(self):
        fixture = load_risk_fixture("risk-episode-frequency.json")
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                policy = copy.deepcopy(DEFAULT_RISK_POLICY)
                policy["rollup"]["frequencyRules"] = case["frequencyRules"]
                if case.get("expectError"):
                    with self.assertRaises(TypeError):
                        rollup_episode_risk(case["steps"], policy)
                else:
                    self.assertEqual(rollup_episode_risk(case["steps"], policy), case["expected"])


class RiskPolicyTemperatureTests(unittest.TestCase):
    """Native temperature-derivation checks beyond the fixture (byte parity with risk-policy.ts)."""

    def test_no_options_returns_reference_copy_without_mutation(self):
        policy = risk_policy()
        self.assertEqual(policy["policyVersion"], "veritio.reference.v1")
        self.assertEqual(policy["bands"], DEFAULT_RISK_POLICY["bands"])
        policy["bands"]["low"] = 0.99
        self.assertEqual(DEFAULT_RISK_POLICY["bands"]["low"], 0.05)

    def test_non_finite_temperature_fails_closed(self):
        with self.assertRaisesRegex(TypeError, "temperature"):
            risk_policy({"temperature": float("nan")})
        with self.assertRaisesRegex(TypeError, "temperature"):
            risk_policy({"temperature": float("inf")})

    def test_bool_temperature_fails_closed(self):
        with self.assertRaisesRegex(TypeError, "temperature"):
            risk_policy({"temperature": True})

    def test_overrides_require_policy_version(self):
        with self.assertRaisesRegex(TypeError, "policyVersion"):
            risk_policy({"overrides": {"bands": {"low": 0.1}}})

    def test_empty_overrides_are_ignored(self):
        self.assertEqual(risk_policy({"overrides": {}}), risk_policy())


class EpisodeFrequencyRuleTests(unittest.TestCase):
    """Native frequency-rule checks: rule-free byte-stability and fail-closed validation."""

    STEPS = [
        {"occurredAt": "2026-06-23T00:00:00.000Z", "score": 0.1, "action": "auth.login.failed"},
        {"occurredAt": "2026-06-23T00:01:00.000Z", "score": 0.1, "action": "auth.login.failed"},
    ]

    def test_policy_without_frequency_rules_key_is_rule_free(self):
        # A hand-built pre-frequency policy dict (no "frequencyRules" key) must emit no
        # frequency fields, matching the pre-frequency protocol output byte-for-byte.
        policy = {
            "policyVersion": "veritio.reference.v1",
            "bands": DEFAULT_RISK_POLICY["bands"],
            "rollup": {"windowSeconds": 60, "decayPerWindow": 0.5, "velocityNormalizer": 3.0},
        }
        result = rollup_episode_risk(self.STEPS, policy)
        self.assertNotIn("frequencyScore", result)
        self.assertNotIn("frequencyMatches", result)

    def test_empty_frequency_rules_emit_no_frequency_keys(self):
        policy = copy.deepcopy(DEFAULT_RISK_POLICY)
        policy["rollup"]["frequencyRules"] = []
        result = rollup_episode_risk(self.STEPS, policy)
        self.assertNotIn("frequencyScore", result)
        self.assertNotIn("frequencyMatches", result)

    def test_nan_boost_fails_closed(self):
        policy = copy.deepcopy(DEFAULT_RISK_POLICY)
        policy["rollup"]["frequencyRules"] = [
            {"actions": ["auth.login.failed"], "windowSeconds": 300, "threshold": 2, "boost": float("nan")}
        ]
        with self.assertRaisesRegex(TypeError, "boost"):
            rollup_episode_risk(self.STEPS, policy)

    def test_bool_threshold_fails_closed(self):
        policy = copy.deepcopy(DEFAULT_RISK_POLICY)
        policy["rollup"]["frequencyRules"] = [
            {"actions": ["auth.login.failed"], "windowSeconds": 300, "threshold": True, "boost": 0.5}
        ]
        with self.assertRaisesRegex(TypeError, "threshold"):
            rollup_episode_risk(self.STEPS, policy)

    def test_integer_valued_float_threshold_is_accepted(self):
        # TS Number.isInteger(2.0)===true, so a whole-float threshold must validate.
        policy = copy.deepcopy(DEFAULT_RISK_POLICY)
        policy["rollup"]["frequencyRules"] = [
            {"actions": ["auth.login.failed"], "windowSeconds": 300, "threshold": 2.0, "boost": 0.5}
        ]
        result = rollup_episode_risk(self.STEPS, policy)
        self.assertTrue(result["frequencyMatches"][0]["fired"])


class CrossLanguageHashAnchorTests(unittest.TestCase):
    """Frozen tri-language anchors proving the canonical-JSON whole-float fix.

    The risk scorer emits whole floats (multiplier weights 1.0, zero-magnitude
    contributions 0.0, clamped 1.0 score). Before the fix Python canonical JSON
    rendered these as "1.0"/"0.0" while TS/Go render "1"/"0", so a SCORED assertion
    and the security.risk.assessed event hashed differently in Python. The two hex
    anchors below were computed identically by the TypeScript, Go, and (post-fix)
    Python SDKs for the same inputs; if Python diverges again this test fails.
    """

    def test_scored_assertion_hash_matches_ts_and_go(self):
        assessment = score_risk_signals({"operationType": "create", "dataVolume": 1})
        assertion = create_security_risk_assertion(
            {
                "id": "asr_fixture_risk_01",
                "scope": {"tenantId": "org_fixture_123", "workspaceId": "wks_fixture_456", "environment": "production"},
                "occurredAt": "2026-06-23T00:00:00.000Z",
                "producerId": "veritio.detectors.risk",
                "idempotencyKey": "risk:chg_fixture_01:step",
                "subject": {"authority": "veritio", "kind": "change", "type": "billing.plan", "id": "chg_fixture_01"},
                "conclusion": {
                    "score": assessment["score"],
                    "level": assessment["level"],
                    "policyVersion": assessment["policyVersion"],
                    "assessment": "step",
                },
                "factors": assessment["factors"],
            }
        )
        self.assertEqual(
            hash_assertion_record(assertion),
            "c58adaf1c0dcc25adf274410e094a9bddb0494beda2539866e376a66106f3322",
        )

    def test_assessed_event_hash_matches_ts_and_go(self):
        event_input = build_security_risk_assessed_event(
            {
                "occurredAt": "2026-06-23T00:00:00.000Z",
                "scope": {"tenantId": "org_fixture_123", "environment": "production"},
                "producerId": "veritio.detectors.risk",
                "subject": {"authority": "veritio", "kind": "change", "type": "billing.plan", "id": "chg_fixture_01"},
                "conclusion": {"score": 1.0, "level": "critical", "policyVersion": "veritio.reference.v1", "assessment": "step"},
                "activityEpisodeId": "ep_1",
                "metadata": {"note": "x"},
            }
        )
        event_input["id"] = "evt_assessed_fixture"
        record = create_audit_event(event_input)
        self.assertEqual(
            hash_audit_event(record),
            "a74bd21afaaae794e7477ac4536bdacccff641e5e9b9b5f305af2644ef997f09",
        )


if __name__ == "__main__":
    unittest.main()
