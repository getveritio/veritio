package veritio

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestRiskDeterminismPrimitives(t *testing.T) {
	if got := clamp01(2); got != 1 {
		t.Fatalf("clamp01(2) = %v, want 1", got)
	}
	if got := clamp01(-0.5); got != 0 {
		t.Fatalf("clamp01(-0.5) = %v, want 0", got)
	}
	if got := clamp01(0.42); got != 0.42 {
		t.Fatalf("clamp01(0.42) = %v, want 0.42", got)
	}
	if got := round4(0.12345); got != 0.1235 {
		t.Fatalf("round4(0.12345) = %v, want 0.1235", got)
	}
	if got := round4(2.0 / 3.0); got != 0.6667 {
		t.Fatalf("round4(2/3) = %v, want 0.6667", got)
	}
	if got := sat(0, 100); got != 0 {
		t.Fatalf("sat(0,100) = %v, want 0", got)
	}
	if got := round4(sat(120, 100)); got != 0.5455 {
		t.Fatalf("round4(sat(120,100)) = %v, want 0.5455", got)
	}
}

func TestBandOfBoundaries(t *testing.T) {
	bands := DefaultRiskPolicy.Bands
	cases := []struct {
		score float64
		level RiskLevel
	}{
		{0.0, "none"}, {0.049, "none"}, {0.05, "low"}, {0.249, "low"},
		{0.25, "medium"}, {0.499, "medium"}, {0.50, "high"}, {0.749, "high"},
		{0.75, "critical"}, {1.0, "critical"},
	}
	for _, c := range cases {
		if got := BandOf(c.score, bands); got != c.level {
			t.Fatalf("BandOf(%v) = %s, want %s", c.score, got, c.level)
		}
	}
}

func TestDefaultRiskPolicyConstants(t *testing.T) {
	if DefaultRiskPolicy.PolicyVersion != "veritio.reference.v1" {
		t.Fatalf("policyVersion = %s", DefaultRiskPolicy.PolicyVersion)
	}
	if DefaultRiskPolicy.OperationBase["destructive"] != 0.85 {
		t.Fatalf("destructive base = %v", DefaultRiskPolicy.OperationBase["destructive"])
	}
	if DefaultRiskPolicy.Magnitude.MaxBoost != 0.40 {
		t.Fatalf("maxBoost = %v", DefaultRiskPolicy.Magnitude.MaxBoost)
	}
	if DefaultRiskPolicy.Rollup.DecayPerWindow != 0.5 || DefaultRiskPolicy.Rollup.VelocityNormalizer != 3.0 {
		t.Fatalf("rollup = %#v", DefaultRiskPolicy.Rollup)
	}
}

func TestNormalizeRiskSignalsDefaultsAndFailsClosed(t *testing.T) {
	normalized, err := NormalizeRiskSignals(RiskSignals{OperationType: "update"})
	if err != nil {
		t.Fatalf("NormalizeRiskSignals error: %v", err)
	}
	want := RiskSignals{OperationType: "update", Reversibility: "recoverable", EnvCriticality: "production"}
	if normalized != want {
		t.Fatalf("normalized = %#v, want %#v", normalized, want)
	}
	failing := []RiskSignals{
		{OperationType: "frobnicate"},
		{OperationType: "read", Reversibility: "maybe"},
		{OperationType: "read", EnvCriticality: "moon"},
		{OperationType: "read", DataVolume: -1},
		{OperationType: "read", FanOut: 1.5},
	}
	for _, signals := range failing {
		if _, err := NormalizeRiskSignals(signals); err == nil {
			t.Fatalf("expected fail-closed error for %#v", signals)
		}
	}
}

func TestRiskSignalsNormalizationMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "risk-signals-normalization.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			normalized, err := NormalizeRiskSignals(decodeValue[RiskSignals](t, conformanceCase["input"]))
			if expected, ok := conformanceCase["normalized"]; ok {
				if err != nil {
					t.Fatalf("NormalizeRiskSignals returned error: %v", err)
				}
				actual := toJSONMap(t, normalized)
				if !reflect.DeepEqual(actual, mapValue(t, expected)) {
					t.Fatalf("expected %#v, got %#v", mapValue(t, expected), actual)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected fail-closed normalization error for %s", caseName(t, conformanceCase))
			}
		})
	}
}

func TestScoreRiskSignalsDeterministicExamples(t *testing.T) {
	updateAssessment, err := ScoreRiskSignals(RiskSignals{OperationType: "update", Reversibility: "recoverable", EnvCriticality: "production"}, DefaultRiskPolicy)
	if err != nil {
		t.Fatalf("ScoreRiskSignals(update) error: %v", err)
	}
	if updateAssessment.Score != 0.30 || updateAssessment.Level != "medium" {
		t.Fatalf("update score=%v level=%s", updateAssessment.Score, updateAssessment.Level)
	}
	if updateAssessment.PolicyVersion != "veritio.reference.v1" || len(updateAssessment.Factors) != 6 {
		t.Fatalf("policy=%s factors=%d", updateAssessment.PolicyVersion, len(updateAssessment.Factors))
	}
	if updateAssessment.Factors[0].Key != "operationType" || updateAssessment.Factors[0].Kind != "base" {
		t.Fatalf("factor[0]=%#v", updateAssessment.Factors[0])
	}
	if updateAssessment.Factors[5].Key != "envCriticality" || updateAssessment.Factors[5].Kind != "multiplier" {
		t.Fatalf("factor[5]=%#v", updateAssessment.Factors[5])
	}

	configAssessment, err := ScoreRiskSignals(RiskSignals{OperationType: "config", Reversibility: "recoverable", EnvCriticality: "staging", DataVolume: 50, FanOut: 10, ReferenceCount: 25}, DefaultRiskPolicy)
	if err != nil {
		t.Fatalf("ScoreRiskSignals(config) error: %v", err)
	}
	if configAssessment.Score != 0.4622 || configAssessment.Level != "medium" {
		t.Fatalf("config score=%v level=%s", configAssessment.Score, configAssessment.Level)
	}
	dv := configAssessment.Factors[1]
	if dv.Key != "dataVolume" || dv.Kind != "additive" || dv.Contribution != 0.0667 || dv.Value != float64(50) {
		t.Fatalf("dataVolume factor=%#v", dv)
	}
}

func TestScoreRiskSignalsFailsClosedOnInvalidSignals(t *testing.T) {
	// Parity with risk.ts/risk.py: scoring normalizes first and fails closed on an
	// invalid enum or magnitude — never a silent score=0/level="none".
	if _, err := ScoreRiskSignals(RiskSignals{OperationType: "frobnicate"}, DefaultRiskPolicy); err == nil {
		t.Fatal("expected fail-closed error for invalid operationType")
	}
	if _, err := ScoreRiskSignals(RiskSignals{OperationType: "update", FanOut: 1.5}, DefaultRiskPolicy); err == nil {
		t.Fatal("expected fail-closed error for fractional fanOut")
	}
}

func TestRiskScoringMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "risk-scoring-default-policy.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			// ScoreRiskSignals normalizes internally (parity with TS/Python), so the
			// raw fixture signals are passed straight through.
			assessment, err := ScoreRiskSignals(decodeValue[RiskSignals](t, conformanceCase["signals"]), DefaultRiskPolicy)
			if err != nil {
				t.Fatalf("ScoreRiskSignals returned error: %v", err)
			}
			actual := toJSONMap(t, assessment)
			expected := mapValue(t, conformanceCase["expected"])
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("expected %#v, got %#v", expected, actual)
			}
		})
	}
}

func TestRollupEpisodeRiskCompoundsMomentum(t *testing.T) {
	rollup, err := RollupEpisodeRisk([]EpisodeRiskStep{
		{OccurredAt: "2026-06-23T10:00:00.000Z", Score: 0.30},
		{OccurredAt: "2026-06-23T10:00:30.000Z", Score: 0.40},
		{OccurredAt: "2026-06-23T10:02:00.000Z", Score: 0.20},
	}, DefaultRiskPolicy)
	if err != nil {
		t.Fatalf("RollupEpisodeRisk error: %v", err)
	}
	want := EpisodeRiskRollup{Score: 0.40, Level: "medium", Peak: 0.40, VelocityScore: 0.2333, StepCount: 3, PolicyVersion: "veritio.reference.v1"}
	// EpisodeRiskRollup now carries an optional []FrequencyRuleMatch, so it is no
	// longer directly comparable; a rule-free rollup must still equal the plain want.
	if !reflect.DeepEqual(rollup, want) {
		t.Fatalf("rollup=%#v, want %#v", rollup, want)
	}

	empty, err := RollupEpisodeRisk(nil, DefaultRiskPolicy)
	if err != nil {
		t.Fatalf("RollupEpisodeRisk(nil) error: %v", err)
	}
	if empty.StepCount != 0 || empty.Score != 0 || empty.Level != "none" {
		t.Fatalf("empty rollup=%#v", empty)
	}
}

func TestRiskEpisodeRollupMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "risk-episode-rollup.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			rawSteps, ok := conformanceCase["steps"].([]any)
			if !ok {
				t.Fatalf("steps must be an array")
			}
			steps := make([]EpisodeRiskStep, 0, len(rawSteps))
			for _, raw := range rawSteps {
				steps = append(steps, decodeValue[EpisodeRiskStep](t, raw))
			}
			rollup, err := RollupEpisodeRisk(steps, DefaultRiskPolicy)
			if err != nil {
				t.Fatalf("RollupEpisodeRisk error: %v", err)
			}
			actual := toJSONMap(t, rollup)
			expected := mapValue(t, conformanceCase["expected"])
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("expected %#v, got %#v", expected, actual)
			}
		})
	}
}

func TestWithRiskSignalsStampsNormalizedSignals(t *testing.T) {
	out, err := WithRiskSignals(map[string]any{"existing": "kept", "riskSignals": "caller_shadow"}, RiskSignals{OperationType: "update", DataVolume: 120})
	if err != nil {
		t.Fatalf("WithRiskSignals error: %v", err)
	}
	if out["existing"] != "kept" {
		t.Fatalf("existing dropped: %#v", out)
	}
	expected := map[string]any{
		"operationType":  "update",
		"reversibility":  "recoverable",
		"envCriticality": "production",
		"dataVolume":     float64(120),
		"fanOut":         float64(0),
		"referenceCount": float64(0),
	}
	if !reflect.DeepEqual(out["riskSignals"], expected) {
		t.Fatalf("riskSignals=%#v, want %#v", out["riskSignals"], expected)
	}
	if _, err := WithRiskSignals(map[string]any{}, RiskSignals{OperationType: "nope"}); err == nil {
		t.Fatal("expected fail-closed normalization error")
	}
}

func TestCreateSecurityRiskAssertionStampsProtocolLiterals(t *testing.T) {
	assertion, err := CreateSecurityRiskAssertion(SecurityRiskAssertionInput{
		ID:             "assertion_risk_01",
		Scope:          EvidenceScope{TenantID: "org_123", Environment: "production"},
		OccurredAt:     "2026-06-23T10:00:00.000Z",
		ProducerID:     "risk-detector",
		IdempotencyKey: "risk:chg_01:step",
		Subject:        EvidenceRef{Authority: "veritio", Kind: "change", Type: "project_entry", ID: "chg_01"},
		Conclusion:     RiskConclusion{Score: 0.4622, Level: "medium", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
		Factors:        []RiskFactor{{Key: "operationType", Value: "config", Kind: "base", Weight: 1, Contribution: 0.45}},
	})
	if err != nil {
		t.Fatalf("CreateSecurityRiskAssertion error: %v", err)
	}
	if assertion.RecordType != "assertion.recorded" || assertion.Type != "security.risk" || assertion.RecordAuthority != "veritio" || assertion.SchemaVersion != "2026-06-23" {
		t.Fatalf("unexpected literals: %#v", assertion)
	}
	wantProducer := AssertionProducer{Authority: "veritio.detectors", Kind: "principal", Type: "service", ID: "risk-detector"}
	if assertion.Producer != wantProducer {
		t.Fatalf("producer=%#v", assertion.Producer)
	}
	if len(assertion.IdempotencyKeyHash) != 64 {
		t.Fatalf("idempotencyKeyHash not tenant-scope bare hex: %s", assertion.IdempotencyKeyHash)
	}
	if _, err := CreateSecurityRiskAssertion(SecurityRiskAssertionInput{ID: "assertion_risk_02", OccurredAt: "2026-06-23T10:00:00.000Z", ProducerID: "d", IdempotencyKey: "k", Subject: EvidenceRef{Authority: "veritio", Kind: "change", Type: "t", ID: "i"}}); err == nil {
		t.Fatal("expected scope.tenantId fail-closed error")
	}
}

func TestHashAssertionRecordIsDeterministicAndSensitive(t *testing.T) {
	build := func(id string) SecurityRiskAssertion {
		a, err := CreateSecurityRiskAssertion(SecurityRiskAssertionInput{
			ID:             id,
			Scope:          EvidenceScope{TenantID: "org_123", Environment: "production"},
			OccurredAt:     "2026-06-23T10:00:00.000Z",
			ProducerID:     "risk-detector",
			IdempotencyKey: "risk:chg_01:step",
			Subject:        EvidenceRef{Authority: "veritio", Kind: "change", Type: "project_entry", ID: "chg_01"},
			Conclusion:     RiskConclusion{Score: 0.4622, Level: "medium", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
			Factors:        []RiskFactor{},
		})
		if err != nil {
			t.Fatalf("CreateSecurityRiskAssertion error: %v", err)
		}
		return a
	}
	first, err := HashAssertionRecord(build("assertion_risk_01"))
	if err != nil {
		t.Fatalf("hash error: %v", err)
	}
	again, _ := HashAssertionRecord(build("assertion_risk_01"))
	if first != again {
		t.Fatalf("hash not deterministic: %s vs %s", first, again)
	}
	if len(first) != 64 {
		t.Fatalf("hash not bare sha256 hex: %s", first)
	}
	other, _ := HashAssertionRecord(build("assertion_risk_02"))
	if other == first {
		t.Fatal("hash insensitive to id change")
	}
}

func TestSecurityRiskAssertionMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "security-risk-assertion.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			assertion, err := CreateSecurityRiskAssertion(decodeValue[SecurityRiskAssertionInput](t, conformanceCase["input"]))
			if err != nil {
				t.Fatalf("CreateSecurityRiskAssertion error: %v", err)
			}
			actual := toJSONMap(t, assertion)
			expected := mapValue(t, conformanceCase["expected"])
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("expected %#v, got %#v", expected, actual)
			}
		})
	}
}

func TestAssertionHashingMatchesConformanceFixtures(t *testing.T) {
	cases := fixtureCases(t, "assertion-hashing.json")
	// Guard against a vacuous pass: the loader must iterate every fixture case, not
	// silently skip them if the fixture array is empty or mis-keyed.
	if len(cases) == 0 {
		t.Fatal("assertion-hashing.json must define at least one case")
	}
	for _, conformanceCase := range cases {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			actual, err := HashAssertionRecord(decodeValue[SecurityRiskAssertion](t, conformanceCase["assertion"]))
			if err != nil {
				t.Fatalf("HashAssertionRecord error: %v", err)
			}
			expected := stringValue(t, conformanceCase["expectedHash"])
			if actual != expected {
				t.Fatalf("expected %s, got %s", expected, actual)
			}
		})
	}
}

func TestBuildSecurityRiskAssessedEventThreadsEpisode(t *testing.T) {
	eventInput, err := BuildSecurityRiskAssessedEvent(SecurityRiskAssessedEventInput{
		OccurredAt:        "2026-06-23T10:00:00.000Z",
		Scope:             EvidenceScope{TenantID: "org_123", Environment: "production"},
		ProducerID:        "risk-detector",
		Subject:           EvidenceRef{Authority: "veritio", Kind: "change", Type: "project_entry", ID: "chg_01"},
		Conclusion:        RiskConclusion{Score: 0.4622, Level: "medium", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
		Factors:           []RiskFactor{{Key: "operationType", Value: "config", Kind: "base", Weight: 1, Contribution: 0.45}},
		ActivityEpisodeID: "episode_real_01",
		Metadata:          map[string]any{"note": "kept"},
	})
	if err != nil {
		t.Fatalf("BuildSecurityRiskAssessedEvent error: %v", err)
	}
	if eventInput.Action != "security.risk.assessed" {
		t.Fatalf("action=%s", eventInput.Action)
	}
	if eventInput.Target.Type != "project_entry" || eventInput.Target.ID != "chg_01" {
		t.Fatalf("target=%#v", eventInput.Target)
	}
	// Actor id is the BARE producerId (parity with TS/Python), not authority-qualified.
	if eventInput.Actor.Type != "service" || eventInput.Actor.ID != "risk-detector" {
		t.Fatalf("actor=%#v", eventInput.Actor)
	}
	event, err := CreateAuditEvent(eventInput)
	if err != nil {
		t.Fatalf("CreateAuditEvent error: %v", err)
	}
	if event.Action != "security.risk.assessed" {
		t.Fatalf("event action=%s", event.Action)
	}
	if event.Metadata["activityEpisodeId"] != "episode_real_01" || event.Metadata["note"] != "kept" {
		t.Fatalf("metadata=%#v", event.Metadata)
	}
	// The conclusion rides as ONE riskAssessment object (parity with TS/Python),
	// not separate subject/conclusion/factors keys.
	if _, hasSubject := event.Metadata["subject"]; hasSubject {
		t.Fatalf("unexpected legacy subject metadata key: %#v", event.Metadata)
	}
	riskAssessment, ok := event.Metadata["riskAssessment"].(map[string]any)
	if !ok {
		t.Fatalf("riskAssessment missing or wrong type: %#v", event.Metadata["riskAssessment"])
	}
	if riskAssessment["score"] != 0.4622 || riskAssessment["level"] != "medium" ||
		riskAssessment["policyVersion"] != "veritio.reference.v1" || riskAssessment["assessment"] != "step" {
		t.Fatalf("riskAssessment=%#v", riskAssessment)
	}
	factors, ok := riskAssessment["factors"].([]any)
	if !ok || len(factors) != 1 {
		t.Fatalf("riskAssessment.factors=%#v", riskAssessment["factors"])
	}
	factor, ok := factors[0].(map[string]any)
	if !ok || factor["key"] != "operationType" || factor["value"] != "config" {
		t.Fatalf("factor[0]=%#v", factors[0])
	}

	if _, err := BuildSecurityRiskAssessedEvent(SecurityRiskAssessedEventInput{
		OccurredAt: "2026-06-23T10:00:00.000Z",
		Scope:      EvidenceScope{TenantID: "org_123"},
		ProducerID: "risk-detector",
		Subject:    EvidenceRef{Authority: "veritio", Kind: "change", Type: "project_entry", ID: "chg_01"},
		Conclusion: RiskConclusion{Score: 0.5, Level: "medium", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
		Metadata:   map[string]any{"activityEpisodeId": "caller_shadow"},
	}); err == nil {
		t.Fatal("expected reserved activityEpisodeId shadow rejection")
	}
}

func TestNormalizeMagnitudeRejectsNonFinite(t *testing.T) {
	// JSON cannot express Infinity/NaN, so this divergence is only reachable from
	// native Go callers. +Inf is the dangerous case the pre-fix guard let through:
	// Floor(+Inf)==+Inf and +Inf<0 is false, so it produced a NaN score that bands
	// as "critical" and then dies unsanitized inside HashAssertionRecord's marshal.
	failing := []RiskSignals{
		{OperationType: "read", DataVolume: math.Inf(1)},
		{OperationType: "read", FanOut: math.Inf(1)},
		{OperationType: "read", ReferenceCount: math.Inf(1)},
		{OperationType: "read", DataVolume: math.Inf(-1)},
		{OperationType: "read", FanOut: math.NaN()},
	}
	for _, signals := range failing {
		if _, err := NormalizeRiskSignals(signals); err == nil {
			t.Fatalf("expected fail-closed error for non-finite magnitude %#v", signals)
		}
		// Scoring normalizes first, so it must fail closed identically rather than
		// returning a NaN score with a nil error.
		if _, err := ScoreRiskSignals(signals, DefaultRiskPolicy); err == nil {
			t.Fatalf("expected ScoreRiskSignals fail-closed for %#v", signals)
		}
	}
}

func TestNormalizeMagnitudeCoercesNegativeZero(t *testing.T) {
	// -0.0 passes the integer/non-negative guard; it must be coerced to +0.0 so the
	// metadata/factor bytes match TypeScript/Python (which render -0 as "0").
	normalized, err := NormalizeRiskSignals(RiskSignals{OperationType: "read", DataVolume: math.Copysign(0, -1)})
	if err != nil {
		t.Fatalf("NormalizeRiskSignals(-0) error: %v", err)
	}
	if math.Signbit(normalized.DataVolume) {
		t.Fatalf("dataVolume retained negative zero: %v", normalized.DataVolume)
	}
}

func TestCreateSecurityRiskAssertionRejectsInvalidAssessment(t *testing.T) {
	// Parity with risk.ts/risk.py: only "step" / "episode_rollup" are valid.
	_, err := CreateSecurityRiskAssertion(SecurityRiskAssertionInput{
		Scope:          EvidenceScope{TenantID: "org_123", Environment: "production"},
		OccurredAt:     "2026-06-23T10:00:00.000Z",
		ProducerID:     "risk-detector",
		IdempotencyKey: "risk:chg_01:step",
		Subject:        EvidenceRef{Authority: "veritio", Kind: "change", Type: "project_entry", ID: "chg_01"},
		Conclusion:     RiskConclusion{Score: 0.5, Level: "medium", PolicyVersion: "veritio.reference.v1", Assessment: "bogus"},
	})
	if err == nil {
		t.Fatal("expected fail-closed error for invalid conclusion.assessment")
	}
}

func TestRiskConclusionValidationFailsClosed(t *testing.T) {
	// A precomputed conclusion with a non-finite/out-of-range score or unknown level
	// must fail closed in BOTH builders before it can reach the canonical hash (where
	// NaN/Inf raise an unsanitized json error) or stamp an unrecognized band.
	base := SecurityRiskAssertionInput{
		Scope:          EvidenceScope{TenantID: "org_123", Environment: "production"},
		OccurredAt:     "2026-06-23T10:00:00.000Z",
		ProducerID:     "risk-detector",
		IdempotencyKey: "risk:chg_01:step",
		Subject:        EvidenceRef{Authority: "veritio", Kind: "change", Type: "project_entry", ID: "chg_01"},
	}
	badConclusions := []RiskConclusion{
		{Score: math.Inf(1), Level: "critical", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
		{Score: math.NaN(), Level: "critical", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
		{Score: 1.5, Level: "critical", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
		{Score: -0.1, Level: "critical", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
		{Score: 0.5, Level: "unknown", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
	}
	for _, conclusion := range badConclusions {
		assertionInput := base
		assertionInput.Conclusion = conclusion
		if _, err := CreateSecurityRiskAssertion(assertionInput); err == nil {
			t.Fatalf("expected CreateSecurityRiskAssertion fail-closed for %#v", conclusion)
		}
		if _, err := BuildSecurityRiskAssessedEvent(SecurityRiskAssessedEventInput{
			OccurredAt: "2026-06-23T10:00:00.000Z",
			Scope:      EvidenceScope{TenantID: "org_123", Environment: "production"},
			ProducerID: "risk-detector",
			Subject:    EvidenceRef{Authority: "veritio", Kind: "change", Type: "project_entry", ID: "chg_01"},
			Conclusion: conclusion,
		}); err == nil {
			t.Fatalf("expected BuildSecurityRiskAssessedEvent fail-closed for %#v", conclusion)
		}
	}
}

func TestCreateSecurityRiskAssertionAutoGeneratesIdAndOccurredAt(t *testing.T) {
	// Parity with risk.ts/risk.py: an omitted id is auto-generated (asr_ prefix) and
	// an omitted occurredAt defaults to a normalized millisecond-UTC "now".
	assertion, err := CreateSecurityRiskAssertion(SecurityRiskAssertionInput{
		Scope:          EvidenceScope{TenantID: "org_123", Environment: "production"},
		ProducerID:     "risk-detector",
		IdempotencyKey: "risk:chg_01:step",
		Subject:        EvidenceRef{Authority: "veritio", Kind: "change", Type: "project_entry", ID: "chg_01"},
		Conclusion:     RiskConclusion{Score: 0.4622, Level: "medium", PolicyVersion: "veritio.reference.v1", Assessment: "step"},
	})
	if err != nil {
		t.Fatalf("CreateSecurityRiskAssertion error: %v", err)
	}
	if !strings.HasPrefix(assertion.ID, "asr_") || len(assertion.ID) <= len("asr_") {
		t.Fatalf("expected auto-generated asr_ id, got %q", assertion.ID)
	}
	if assertion.OccurredAt == "" || !strings.HasSuffix(assertion.OccurredAt, "Z") {
		t.Fatalf("expected auto-generated millisecond-UTC occurredAt, got %q", assertion.OccurredAt)
	}
	// The auto-generated assertion must still hash without error.
	if _, err := HashAssertionRecord(assertion); err != nil {
		t.Fatalf("HashAssertionRecord error: %v", err)
	}
}

func TestRiskPolicyTemperatureMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "risk-policy-temperature.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			options := decodeValue[RiskPolicyOptions](t, conformanceCase["options"])
			policy, err := RiskPolicy(options)
			if _, expectErr := conformanceCase["expectError"]; expectErr {
				if err == nil {
					t.Fatalf("expected fail-closed error for %s", caseName(t, conformanceCase))
				}
				return
			}
			if err != nil {
				t.Fatalf("RiskPolicy error: %v", err)
			}
			expected := mapValue(t, conformanceCase["expectedPolicy"])
			// The RiskScoringPolicy struct is intentionally untagged, so compare every
			// leaf explicitly against the fixture map rather than round-tripping the
			// whole struct. Full coverage (not just scaled fields) proves derivation
			// never disturbs any pinned constant.
			if policy.PolicyVersion != stringValue(t, expected["policyVersion"]) {
				t.Fatalf("policyVersion = %s, want %v", policy.PolicyVersion, expected["policyVersion"])
			}
			assertPolicyFloatMap(t, "operationBase", policy.OperationBase, mapValue(t, expected["operationBase"]))
			assertPolicyFloatMap(t, "reversibilityFactor", policy.ReversibilityFactor, mapValue(t, expected["reversibilityFactor"]))
			assertPolicyFloatMap(t, "envCriticalityFactor", policy.EnvCriticalityFactor, mapValue(t, expected["envCriticalityFactor"]))
			bands := mapValue(t, expected["bands"])
			assertPolicyFloat(t, "bands.low", policy.Bands.Low, bands["low"])
			assertPolicyFloat(t, "bands.medium", policy.Bands.Medium, bands["medium"])
			assertPolicyFloat(t, "bands.high", policy.Bands.High, bands["high"])
			assertPolicyFloat(t, "bands.critical", policy.Bands.Critical, bands["critical"])
			rollup := mapValue(t, expected["rollup"])
			assertPolicyFloat(t, "rollup.windowSeconds", policy.Rollup.WindowSeconds, rollup["windowSeconds"])
			assertPolicyFloat(t, "rollup.decayPerWindow", policy.Rollup.DecayPerWindow, rollup["decayPerWindow"])
			assertPolicyFloat(t, "rollup.velocityNormalizer", policy.Rollup.VelocityNormalizer, rollup["velocityNormalizer"])
			expectedRules, hasRules := rollup["frequencyRules"].([]any)
			if !hasRules {
				t.Fatalf("rollup.frequencyRules missing from fixture expectedPolicy")
			}
			if len(policy.Rollup.FrequencyRules) != len(expectedRules) {
				t.Fatalf("rollup.frequencyRules length = %d, want %d", len(policy.Rollup.FrequencyRules), len(expectedRules))
			}
			magnitude := mapValue(t, expected["magnitude"])
			assertPolicyFloat(t, "magnitude.maxBoost", policy.Magnitude.MaxBoost, magnitude["maxBoost"])
			weights := mapValue(t, magnitude["weights"])
			assertPolicyFloat(t, "magnitude.weights.dataVolume", policy.Magnitude.Weights.DataVolume, weights["dataVolume"])
			assertPolicyFloat(t, "magnitude.weights.fanOut", policy.Magnitude.Weights.FanOut, weights["fanOut"])
			assertPolicyFloat(t, "magnitude.weights.referenceCount", policy.Magnitude.Weights.ReferenceCount, weights["referenceCount"])
			k := mapValue(t, magnitude["k"])
			assertPolicyFloat(t, "magnitude.k.dataVolume", policy.Magnitude.K.DataVolume, k["dataVolume"])
			assertPolicyFloat(t, "magnitude.k.fanOut", policy.Magnitude.K.FanOut, k["fanOut"])
			assertPolicyFloat(t, "magnitude.k.referenceCount", policy.Magnitude.K.ReferenceCount, k["referenceCount"])
		})
	}
}

// assertPolicyFloatMap compares a derived policy float map against the fixture's
// expected object key-by-key in both directions, so a missing or extra key fails
// as loudly as a wrong value.
func assertPolicyFloatMap(t *testing.T, field string, actual map[string]float64, expected map[string]any) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("%s: key count = %d, want %d", field, len(actual), len(expected))
	}
	for key, want := range expected {
		got, ok := actual[key]
		if !ok {
			t.Fatalf("%s.%s missing from derived policy", field, key)
		}
		assertPolicyFloat(t, field+"."+key, got, want)
	}
}

// assertPolicyFloat compares a derived policy leaf against the fixture's expected
// value (a float64 after JSON decode), failing with the field path on mismatch.
func assertPolicyFloat(t *testing.T, field string, actual float64, expected any) {
	t.Helper()
	want, ok := expected.(float64)
	if !ok {
		t.Fatalf("%s: expected float in fixture, got %#v", field, expected)
	}
	if actual != want {
		t.Fatalf("%s = %v, want %v", field, actual, want)
	}
}

func TestRiskEpisodeFrequencyMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "risk-episode-frequency.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			policy := DefaultRiskPolicy
			policy.Rollup.FrequencyRules = decodeFrequencyRules(t, conformanceCase["frequencyRules"])
			rawSteps, ok := conformanceCase["steps"].([]any)
			if !ok {
				t.Fatalf("steps must be an array")
			}
			steps := make([]EpisodeRiskStep, 0, len(rawSteps))
			for _, raw := range rawSteps {
				steps = append(steps, decodeValue[EpisodeRiskStep](t, raw))
			}
			rollup, err := RollupEpisodeRisk(steps, policy)
			if _, expectErr := conformanceCase["expectError"]; expectErr {
				if err == nil {
					t.Fatalf("expected fail-closed error for %s", caseName(t, conformanceCase))
				}
				return
			}
			if err != nil {
				t.Fatalf("RollupEpisodeRisk error: %v", err)
			}
			actual := toJSONMap(t, rollup)
			expected := mapValue(t, conformanceCase["expected"])
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("expected %#v, got %#v", expected, actual)
			}
		})
	}
}

// decodeFrequencyRules decodes a fixture frequencyRules array into typed rules,
// preserving malformed rules verbatim so the fail-closed cases still reach
// assertFrequencyRules.
func decodeFrequencyRules(t *testing.T, value any) []EpisodeFrequencyRule {
	t.Helper()
	raw, ok := value.([]any)
	if !ok {
		t.Fatalf("frequencyRules must be an array, got %#v", value)
	}
	rules := make([]EpisodeFrequencyRule, 0, len(raw))
	for _, item := range raw {
		rules = append(rules, decodeValue[EpisodeFrequencyRule](t, item))
	}
	return rules
}

func TestRiskPolicyFailsClosedOnNonFiniteTemperature(t *testing.T) {
	// JSON cannot express NaN/Inf, so this divergence is only reachable from native
	// Go callers; it must fail closed exactly as risk.ts/risk.py reject it.
	for _, temperature := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := RiskPolicy(RiskPolicyOptions{Temperature: Float64(temperature)}); err == nil {
			t.Fatalf("expected fail-closed error for temperature %v", temperature)
		}
	}
}

func TestRiskPolicyEmptyOverridesAreIgnored(t *testing.T) {
	// A present-but-empty overrides object must be a no-op returning the reference
	// policy, matching TS hasOverrides (Object.keys length) and Python len(...) > 0.
	// Regression: Go previously gated on != nil only, failing the mandatory
	// policyVersion check that the other SDKs never reach.
	policy, err := RiskPolicy(RiskPolicyOptions{Overrides: &RiskPolicyOverrides{}})
	if err != nil {
		t.Fatalf("empty overrides must be a no-op, got error: %v", err)
	}
	if policy.PolicyVersion != DefaultRiskPolicy.PolicyVersion {
		t.Fatalf("policyVersion = %s, want %s", policy.PolicyVersion, DefaultRiskPolicy.PolicyVersion)
	}
	if policy.Bands != DefaultRiskPolicy.Bands {
		t.Fatalf("bands = %+v, want reference bands", policy.Bands)
	}
}

func TestRollupWithoutRulesEmitsNoFrequencyFields(t *testing.T) {
	// A rule-free policy must stay byte-identical to the pre-frequency output: no
	// frequencyScore/frequencyMatches struct fields and no JSON keys.
	rollup, err := RollupEpisodeRisk([]EpisodeRiskStep{
		{OccurredAt: "2026-06-23T00:00:00.000Z", Score: 0.1, Action: "auth.login.failed"},
	}, DefaultRiskPolicy)
	if err != nil {
		t.Fatalf("RollupEpisodeRisk error: %v", err)
	}
	if rollup.FrequencyScore != nil || rollup.FrequencyMatches != nil {
		t.Fatalf("expected no frequency fields on the struct, got %#v", rollup)
	}
	encoded := toJSONMap(t, rollup)
	if _, ok := encoded["frequencyScore"]; ok {
		t.Fatalf("frequencyScore key must be absent: %#v", encoded)
	}
	if _, ok := encoded["frequencyMatches"]; ok {
		t.Fatalf("frequencyMatches key must be absent: %#v", encoded)
	}
}

func TestRollupFailsClosedOnNonFiniteBoost(t *testing.T) {
	// NaN/Inf boosts are unreachable from JSON but must fail closed for native
	// callers so a corrupt rule can never skew the clamped frequencyScore sum.
	policy := DefaultRiskPolicy
	policy.Rollup.FrequencyRules = []EpisodeFrequencyRule{
		{Actions: []string{"auth.login.failed"}, WindowSeconds: 300, Threshold: 5, Boost: math.NaN()},
	}
	if _, err := RollupEpisodeRisk([]EpisodeRiskStep{
		{OccurredAt: "2026-06-23T00:00:00.000Z", Score: 0.1, Action: "auth.login.failed"},
	}, policy); err == nil {
		t.Fatal("expected fail-closed error for NaN boost")
	}
}

func TestDefaultRiskPolicyHasEmptyFrequencyRules(t *testing.T) {
	// The reference policy must not configure frequency rules; otherwise every
	// existing rollup fixture would gain frequency fields and diverge across SDKs.
	if len(DefaultRiskPolicy.Rollup.FrequencyRules) != 0 {
		t.Fatalf("DefaultRiskPolicy.Rollup.FrequencyRules must be empty, got %#v", DefaultRiskPolicy.Rollup.FrequencyRules)
	}
}
