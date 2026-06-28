package veritio

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"sort"
	"time"
)

// RiskOperationType, RiskReversibility, RiskEnvCriticality, and RiskLevel are
// string aliases that document the language-neutral risk vocabulary shared with
// the TypeScript and Python SDKs. They are aliases (not new named types) so the
// values compare as plain strings across canonical-JSON and reflect comparisons.
type RiskOperationType = string
type RiskReversibility = string
type RiskEnvCriticality = string
type RiskLevel = string

// riskOperationTypes, riskReversibilities, and riskEnvCriticalities are the
// protocol-fixed enum vocabularies. They are independent of any scoring policy so
// an unknown enum always fails closed during normalization rather than silently
// scoring against a missing policy entry.
var riskOperationTypes = map[string]struct{}{
	"read": {}, "create": {}, "update": {}, "config": {},
	"bulk": {}, "permission": {}, "delete": {}, "destructive": {},
}
var riskReversibilities = map[string]struct{}{
	"reversible": {}, "recoverable": {}, "irreversible": {},
}
var riskEnvCriticalities = map[string]struct{}{
	"sandbox": {}, "development": {}, "staging": {}, "production": {},
}

// riskLevels is the protocol-fixed band vocabulary BandOf can emit. A precomputed
// conclusion carrying a level outside this set fails closed before it can stamp an
// unrecognized band into evidence, mirroring the finite/[0,1] score guard.
var riskLevels = map[string]struct{}{
	"none": {}, "low": {}, "medium": {}, "high": {}, "critical": {},
}

// RiskSignals carries host-supplied operation shape used to derive a risk score.
// Magnitudes default to zero and string enums default during normalization so
// downstream scoring is deterministic and byte-identical across SDKs.
type RiskSignals struct {
	OperationType  RiskOperationType  `json:"operationType"`
	Reversibility  RiskReversibility  `json:"reversibility,omitempty"`
	EnvCriticality RiskEnvCriticality `json:"envCriticality,omitempty"`
	DataVolume     float64            `json:"dataVolume"`
	FanOut         float64            `json:"fanOut"`
	ReferenceCount float64            `json:"referenceCount"`
}

// RiskFactor records one explainable contribution to a risk score. Value is the
// enum string for base/multiplier factors and the numeric magnitude for additive
// factors. The factor ordering emitted by ScoreRiskSignals is part of the
// cross-SDK contract and must not change without updating the conformance
// fixtures.
type RiskFactor struct {
	Key          string  `json:"key"`
	Value        any     `json:"value"`
	Kind         string  `json:"kind"`
	Weight       float64 `json:"weight"`
	Contribution float64 `json:"contribution"`
}

// RiskAssessment is the per-step scoring result with an ordered, auditable factor
// breakdown.
type RiskAssessment struct {
	Score         float64      `json:"score"`
	Level         RiskLevel    `json:"level"`
	PolicyVersion string       `json:"policyVersion"`
	Factors       []RiskFactor `json:"factors"`
}

// EpisodeRiskRollup is the windowed momentum rollup across an ordered set of
// per-step scores in one activity episode.
type EpisodeRiskRollup struct {
	Score         float64   `json:"score"`
	Level         RiskLevel `json:"level"`
	Peak          float64   `json:"peak"`
	VelocityScore float64   `json:"velocityScore"`
	StepCount     int       `json:"stepCount"`
	PolicyVersion string    `json:"policyVersion"`
}

// RiskConclusion is the minimized scoring summary embedded in a security risk
// assertion and the assessed event.
type RiskConclusion struct {
	Score         float64   `json:"score"`
	Level         RiskLevel `json:"level"`
	PolicyVersion string    `json:"policyVersion"`
	Assessment    string    `json:"assessment"`
}

// AssertionProducer is the detector principal that emitted a security risk
// assertion.
type AssertionProducer struct {
	Authority string `json:"authority"`
	Kind      string `json:"kind"`
	Type      string `json:"type"`
	ID        string `json:"id"`
}

// SecurityRiskAssertion is the language-neutral assertion record published when a
// risk conclusion crosses a band. recordType is the on-record literal
// "assertion.recorded"; an EvidenceCommit manifest labels the same physical
// record with the member-type "assertion.record".
type SecurityRiskAssertion struct {
	RecordType         string            `json:"recordType"`
	SchemaVersion      string            `json:"schemaVersion"`
	RecordAuthority    string            `json:"recordAuthority"`
	ID                 string            `json:"id"`
	Type               string            `json:"type"`
	Scope              EvidenceScope     `json:"scope"`
	OccurredAt         string            `json:"occurredAt"`
	Producer           AssertionProducer `json:"producer"`
	IdempotencyKeyHash string            `json:"idempotencyKeyHash"`
	Subject            EvidenceRef       `json:"subject"`
	Conclusion         RiskConclusion    `json:"conclusion"`
	Factors            []RiskFactor      `json:"factors"`
}

// RiskMagnitudePolicy parameterizes the saturating additive magnitude boosts.
type RiskMagnitudePolicy struct {
	MaxBoost float64
	Weights  RiskMagnitudeComponents
	K        RiskMagnitudeComponents
}

// RiskMagnitudeComponents groups the per-signal weight and saturation constants.
type RiskMagnitudeComponents struct {
	DataVolume     float64
	FanOut         float64
	ReferenceCount float64
}

// RiskBands defines the inclusive lower bounds for each non-none risk level.
type RiskBands struct {
	Low      float64
	Medium   float64
	High     float64
	Critical float64
}

// RiskRollupPolicy controls episode momentum decay and velocity normalization.
type RiskRollupPolicy struct {
	WindowSeconds      float64
	DecayPerWindow     float64
	VelocityNormalizer float64
}

// RiskScoringPolicy is the full, versioned scoring policy. All math is expressed
// in division, comparison, and repeated multiplication only so the TypeScript,
// Python, and Go SDKs emit byte-identical scores.
type RiskScoringPolicy struct {
	PolicyVersion        string
	OperationBase        map[string]float64
	ReversibilityFactor  map[string]float64
	EnvCriticalityFactor map[string]float64
	Magnitude            RiskMagnitudePolicy
	Bands                RiskBands
	Rollup               RiskRollupPolicy
}

// DefaultRiskPolicy is the reference scoring policy (veritio.reference.v1) shared
// across SDKs. Every constant here must stay identical to risk.ts/risk.py or the
// cross-language conformance fixtures will diverge.
var DefaultRiskPolicy = RiskScoringPolicy{
	PolicyVersion: "veritio.reference.v1",
	OperationBase: map[string]float64{
		"read": 0.05, "create": 0.20, "update": 0.30, "config": 0.45,
		"bulk": 0.55, "permission": 0.60, "delete": 0.70, "destructive": 0.85,
	},
	ReversibilityFactor: map[string]float64{
		"reversible": 0.6, "recoverable": 1.0, "irreversible": 1.3,
	},
	EnvCriticalityFactor: map[string]float64{
		"sandbox": 0.4, "development": 0.6, "staging": 0.8, "production": 1.0,
	},
	Magnitude: RiskMagnitudePolicy{
		MaxBoost: 0.40,
		Weights:  RiskMagnitudeComponents{DataVolume: 0.5, FanOut: 0.3, ReferenceCount: 0.2},
		K:        RiskMagnitudeComponents{DataVolume: 100, FanOut: 25, ReferenceCount: 50},
	},
	Bands:  RiskBands{Low: 0.05, Medium: 0.25, High: 0.50, Critical: 0.75},
	Rollup: RiskRollupPolicy{WindowSeconds: 60, DecayPerWindow: 0.5, VelocityNormalizer: 3.0},
}

// clamp01 constrains a score to the [0,1] interval using comparison only.
func clamp01(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

// round4 rounds half-up to four decimals using integer floor math so every SDK
// produces the same trailing digits regardless of language rounding mode.
func round4(value float64) float64 {
	return math.Floor(value*10000+0.5) / 10000
}

// sat returns the saturating ratio x/(x+k) using division only. k is always
// positive in the reference policy so the denominator never reaches zero.
func sat(value float64, k float64) float64 {
	return value / (value + k)
}

// BandOf maps a numeric score to its risk level using the policy's inclusive
// lower bounds. Scores below the low bound are "none".
func BandOf(score float64, bands RiskBands) RiskLevel {
	if score < bands.Low {
		return "none"
	}
	if score < bands.Medium {
		return "low"
	}
	if score < bands.High {
		return "medium"
	}
	if score < bands.Critical {
		return "high"
	}
	return "critical"
}

// NormalizeRiskSignals validates and defaults host risk signals, failing closed
// on an unknown enum, a negative magnitude, or a non-integer magnitude. Defaults
// are reversibility=recoverable, envCriticality=production, magnitudes=0. The
// returned value is safe to score and to stamp at metadata.riskSignals.
func NormalizeRiskSignals(signals RiskSignals) (RiskSignals, error) {
	if _, ok := riskOperationTypes[signals.OperationType]; !ok {
		return RiskSignals{}, errors.New("operationType is not a supported risk operation type")
	}
	reversibility := signals.Reversibility
	if reversibility == "" {
		reversibility = "recoverable"
	} else if _, ok := riskReversibilities[reversibility]; !ok {
		return RiskSignals{}, errors.New("reversibility is not a supported risk reversibility")
	}
	envCriticality := signals.EnvCriticality
	if envCriticality == "" {
		envCriticality = "production"
	} else if _, ok := riskEnvCriticalities[envCriticality]; !ok {
		return RiskSignals{}, errors.New("envCriticality is not a supported environment criticality")
	}
	dataVolume, err := normalizeMagnitude(signals.DataVolume, "dataVolume")
	if err != nil {
		return RiskSignals{}, err
	}
	fanOut, err := normalizeMagnitude(signals.FanOut, "fanOut")
	if err != nil {
		return RiskSignals{}, err
	}
	referenceCount, err := normalizeMagnitude(signals.ReferenceCount, "referenceCount")
	if err != nil {
		return RiskSignals{}, err
	}
	return RiskSignals{
		OperationType:  signals.OperationType,
		Reversibility:  reversibility,
		EnvCriticality: envCriticality,
		DataVolume:     dataVolume,
		FanOut:         fanOut,
		ReferenceCount: referenceCount,
	}, nil
}

// normalizeMagnitude enforces non-negative integer magnitudes; an absent value is
// already zero and passes. Non-finite (+Inf/-Inf/NaN), fractional, or negative
// magnitudes fail closed so a malformed signal can never reach scoring (where +Inf
// would silently produce a NaN score and band as "critical", then die unsanitized
// in HashAssertionRecord's JSON marshal) or metadata. Parity with risk.ts/risk.py,
// which reject Infinity/NaN during normalization.
func normalizeMagnitude(value float64, field string) (float64, error) {
	if math.IsInf(value, 0) || math.IsNaN(value) || value < 0 || value != math.Floor(value) {
		return 0, errors.New(field + " must be a non-negative integer")
	}
	// Coerce IEEE-754 negative zero to positive zero so the metadata/factor bytes
	// match TypeScript/Python (which render -0 as "0") instead of Go's "-0".
	if value == 0 {
		value = 0
	}
	return value, nil
}

// ScoreRiskSignals normalizes then scores host risk signals into a deterministic
// per-step assessment, FAILING CLOSED (returning an error) on an unknown enum or
// invalid magnitude exactly as risk.ts/risk.py do — an invalid signal can never
// silently degrade to score=0/level="none" or leak a raw bad enum into the factor
// breakdown. The factor list is ordered base, additive(dataVolume, fanOut,
// referenceCount), multiplier(reversibility, envCriticality); this order and the
// field semantics are part of the cross-SDK explainability contract and must match
// the conformance fixtures byte-for-byte. The base factor weight is the protocol-
// fixed 1 (with contribution=operationBase[op]) to stay byte-identical with
// risk.ts/risk.py.
func ScoreRiskSignals(signals RiskSignals, policy RiskScoringPolicy) (RiskAssessment, error) {
	normalized, err := NormalizeRiskSignals(signals)
	if err != nil {
		return RiskAssessment{}, err
	}
	base := policy.OperationBase[normalized.OperationType]
	dvC := round4(policy.Magnitude.MaxBoost * policy.Magnitude.Weights.DataVolume * sat(normalized.DataVolume, policy.Magnitude.K.DataVolume))
	foC := round4(policy.Magnitude.MaxBoost * policy.Magnitude.Weights.FanOut * sat(normalized.FanOut, policy.Magnitude.K.FanOut))
	rcC := round4(policy.Magnitude.MaxBoost * policy.Magnitude.Weights.ReferenceCount * sat(normalized.ReferenceCount, policy.Magnitude.K.ReferenceCount))
	reversibility := policy.ReversibilityFactor[normalized.Reversibility]
	envCriticality := policy.EnvCriticalityFactor[normalized.EnvCriticality]
	score := clamp01(round4((base + dvC + foC + rcC) * reversibility * envCriticality))
	factors := []RiskFactor{
		{Key: "operationType", Value: normalized.OperationType, Kind: "base", Weight: 1, Contribution: base},
		{Key: "dataVolume", Value: normalized.DataVolume, Kind: "additive", Weight: policy.Magnitude.Weights.DataVolume, Contribution: dvC},
		{Key: "fanOut", Value: normalized.FanOut, Kind: "additive", Weight: policy.Magnitude.Weights.FanOut, Contribution: foC},
		{Key: "referenceCount", Value: normalized.ReferenceCount, Kind: "additive", Weight: policy.Magnitude.Weights.ReferenceCount, Contribution: rcC},
		{Key: "reversibility", Value: normalized.Reversibility, Kind: "multiplier", Weight: reversibility, Contribution: reversibility},
		{Key: "envCriticality", Value: normalized.EnvCriticality, Kind: "multiplier", Weight: envCriticality, Contribution: envCriticality},
	}
	return RiskAssessment{
		Score:         score,
		Level:         BandOf(score, policy.Bands),
		PolicyVersion: policy.PolicyVersion,
		Factors:       factors,
	}, nil
}

// EpisodeRiskStep is one scored step in an activity episode.
type EpisodeRiskStep struct {
	OccurredAt string  `json:"occurredAt"`
	Score      float64 `json:"score"`
}

// orderedStep holds a step's parsed time and score after sorting.
type orderedStep struct {
	at    time.Time
	score float64
}

// RollupEpisodeRisk compounds per-step scores into an episode momentum rollup.
// Steps are sorted ascending by occurredAt; momentum decays by an integer number
// of whole windows between consecutive steps using repeated multiplication
// (never math.Pow) so the rollup is byte-identical across SDKs. Non-positive gaps
// clamp to zero windows (no decay). An empty episode yields a zero rollup.
func RollupEpisodeRisk(steps []EpisodeRiskStep, policy RiskScoringPolicy) (EpisodeRiskRollup, error) {
	rollup := EpisodeRiskRollup{
		Level:         BandOf(0, policy.Bands),
		StepCount:     len(steps),
		PolicyVersion: policy.PolicyVersion,
	}
	if len(steps) == 0 {
		return rollup, nil
	}
	ordered := make([]orderedStep, len(steps))
	for index, step := range steps {
		parsed, err := parseStepTime(step.OccurredAt)
		if err != nil {
			return EpisodeRiskRollup{}, err
		}
		ordered[index] = orderedStep{at: parsed, score: step.Score}
	}
	sort.SliceStable(ordered, func(i int, j int) bool {
		return ordered[i].at.Before(ordered[j].at)
	})
	peak := 0.0
	momentum := 0.0
	maxMomentum := 0.0
	for index, step := range ordered {
		if step.score > peak {
			peak = step.score
		}
		decay := 1.0
		if index > 0 {
			gapSeconds := step.at.Sub(ordered[index-1].at).Seconds()
			if gapSeconds < 0 {
				gapSeconds = 0
			}
			windows := int(math.Floor(gapSeconds / policy.Rollup.WindowSeconds))
			for window := 0; window < windows; window++ {
				decay *= policy.Rollup.DecayPerWindow
			}
		}
		momentum = round4(step.score + momentum*decay)
		if momentum > maxMomentum {
			maxMomentum = momentum
		}
	}
	velocityScore := clamp01(round4(maxMomentum / policy.Rollup.VelocityNormalizer))
	rollupScore := clamp01(round4(maxFloat(peak, velocityScore)))
	rollup.Score = rollupScore
	rollup.Level = BandOf(rollupScore, policy.Bands)
	rollup.Peak = peak
	rollup.VelocityScore = velocityScore
	return rollup, nil
}

// maxFloat returns the larger of two scores.
func maxFloat(a float64, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// parseStepTime parses an episode step timestamp with the same UTC rule as the
// governed-change builder (RFC3339 or timezone-naive interpreted as UTC) so the
// cross-language gap math agrees on whole-window counts.
func parseStepTime(value string) (time.Time, error) {
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UTC(), nil
	}
	if parsed, err := time.Parse("2006-01-02T15:04:05.999999999", value); err == nil {
		return parsed.UTC(), nil
	}
	return time.Time{}, errors.New("step occurredAt must be a valid date")
}

// riskSignalsMap renders normalized signals as an explicit JSON-domain map so
// metadata.riskSignals serializes identically across SDKs regardless of Go struct
// omitempty rules. The keys are non-PII and must never match the redaction key
// pattern.
func riskSignalsMap(signals RiskSignals) map[string]any {
	return map[string]any{
		"operationType":  signals.OperationType,
		"reversibility":  signals.Reversibility,
		"envCriticality": signals.EnvCriticality,
		"dataVolume":     signals.DataVolume,
		"fanOut":         signals.FanOut,
		"referenceCount": signals.ReferenceCount,
	}
}

// WithRiskSignals stamps normalized risk signals at metadata.riskSignals without
// mutating the caller's map. Normalization fails closed so an invalid signal can
// never reach metadata, and any caller-supplied riskSignals key is replaced by
// the normalized value.
func WithRiskSignals(metadata map[string]any, signals RiskSignals) (map[string]any, error) {
	normalized, err := NormalizeRiskSignals(signals)
	if err != nil {
		return nil, err
	}
	output := map[string]any{}
	for key, value := range metadata {
		output[key] = value
	}
	output["riskSignals"] = riskSignalsMap(normalized)
	return output, nil
}

// SecurityRiskAssertionInput is the host-facing input for assembling a security
// risk assertion. The caller supplies a precomputed conclusion/factors and a RAW
// idempotency key; this builder never recomputes scoring and tenant-scope hashes
// the idempotency key (it is never stored raw).
type SecurityRiskAssertionInput struct {
	ID             string         `json:"id"`
	Scope          EvidenceScope  `json:"scope"`
	OccurredAt     string         `json:"occurredAt"`
	ProducerID     string         `json:"producerId"`
	IdempotencyKey string         `json:"idempotencyKey"`
	Subject        EvidenceRef    `json:"subject"`
	Conclusion     RiskConclusion `json:"conclusion"`
	Factors        []RiskFactor   `json:"factors"`
}

// validateRiskConclusion fails closed when a precomputed conclusion carries a
// non-finite or out-of-range score or an unknown level, so a malformed conclusion
// can never reach the canonical hash (where NaN/Inf would raise an unsanitized
// "json: unsupported value" error) or stamp an unrecognized band into evidence.
// This mirrors the finite/[0,1] guarantees ScoreRiskSignals and RollupEpisodeRisk
// produce upstream for conclusions assembled by hand.
func validateRiskConclusion(conclusion RiskConclusion) error {
	if math.IsInf(conclusion.Score, 0) || math.IsNaN(conclusion.Score) || conclusion.Score < 0 || conclusion.Score > 1 {
		return errors.New("conclusion.score must be a finite number in [0,1]")
	}
	if _, ok := riskLevels[conclusion.Level]; !ok {
		return errors.New("conclusion.level must be a known risk level")
	}
	return nil
}

// CreateSecurityRiskAssertion assembles a minimized, language-neutral security
// risk assertion from a precomputed conclusion. It stamps the fixed protocol
// literals (so producers cannot drift recordType/type/authority/schemaVersion),
// fails closed on missing tenant/producer/subject and on an invalid conclusion
// (assessment, finite [0,1] score, known level), tenant-scope hashes the raw
// idempotency key, and normalizes occurredAt to millisecond UTC so the hashed byte
// matches TypeScript and Python. Parity with risk.ts/risk.py: an omitted id is
// auto-generated as "asr_"+random hex and an omitted occurredAt defaults to now.
func CreateSecurityRiskAssertion(input SecurityRiskAssertionInput) (SecurityRiskAssertion, error) {
	if input.Scope.TenantID == "" {
		return SecurityRiskAssertion{}, errors.New("scope.tenantId is required")
	}
	if input.ProducerID == "" {
		return SecurityRiskAssertion{}, errors.New("producer.id is required")
	}
	if err := assertEvidenceRef(input.Subject); err != nil {
		return SecurityRiskAssertion{}, err
	}
	if input.Conclusion.Assessment != "step" && input.Conclusion.Assessment != "episode_rollup" {
		return SecurityRiskAssertion{}, errors.New("conclusion.assessment must be 'step' or 'episode_rollup'")
	}
	if err := validateRiskConclusion(input.Conclusion); err != nil {
		return SecurityRiskAssertion{}, err
	}
	id := input.ID
	if id == "" {
		id = "asr_" + randomHex(16)
	}
	occurredAtInput := input.OccurredAt
	if occurredAtInput == "" {
		occurredAtInput = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	}
	occurredAt, err := normalizeAssertionOccurredAt(occurredAtInput)
	if err != nil {
		return SecurityRiskAssertion{}, err
	}
	idempotencyKeyHash, err := HashIdempotencyKey(input.Scope.TenantID, input.IdempotencyKey)
	if err != nil {
		return SecurityRiskAssertion{}, err
	}
	factors := input.Factors
	if factors == nil {
		factors = []RiskFactor{}
	}
	return SecurityRiskAssertion{
		RecordType:         "assertion.recorded",
		SchemaVersion:      "2026-06-23",
		RecordAuthority:    "veritio",
		ID:                 id,
		Type:               "security.risk",
		Scope:              input.Scope,
		OccurredAt:         occurredAt,
		Producer:           AssertionProducer{Authority: "veritio.detectors", Kind: "principal", Type: "service", ID: input.ProducerID},
		IdempotencyKeyHash: idempotencyKeyHash,
		Subject:            input.Subject,
		Conclusion:         input.Conclusion,
		Factors:            factors,
	}, nil
}

// normalizeAssertionOccurredAt mirrors the governed-change occurredAt rule: an
// RFC3339 or timezone-naive (interpreted as UTC) timestamp emitted as millisecond
// UTC, so the hashed byte is deterministic and identical across SDKs.
func normalizeAssertionOccurredAt(value string) (string, error) {
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UTC().Format("2006-01-02T15:04:05.000Z"), nil
	}
	if parsed, err := time.Parse("2006-01-02T15:04:05.999999999", value); err == nil {
		return parsed.UTC().Format("2006-01-02T15:04:05.000Z"), nil
	}
	return "", errors.New("occurredAt must be a valid date")
}

// HashAssertionRecord computes the canonical sha256 hash over a security risk
// assertion's documented protocol fields, mirroring HashAuditRecord. The result
// is a bare lowercase hex digest (no algorithm prefix) so EvidenceCommit
// manifests and cross-language verifiers agree byte-for-byte.
func HashAssertionRecord(assertion SecurityRiskAssertion) (string, error) {
	payload := map[string]any{
		"recordType":         assertion.RecordType,
		"schemaVersion":      assertion.SchemaVersion,
		"recordAuthority":    assertion.RecordAuthority,
		"id":                 assertion.ID,
		"type":               assertion.Type,
		"scope":              assertion.Scope,
		"occurredAt":         assertion.OccurredAt,
		"producer":           assertion.Producer,
		"idempotencyKeyHash": assertion.IdempotencyKeyHash,
		"subject":            assertion.Subject,
		"conclusion":         assertion.Conclusion,
		"factors":            assertion.Factors,
	}
	canonical, err := CanonicalJSON(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:]), nil
}

// SecurityRiskAssessedEventInput threads a precomputed risk conclusion into an
// audit event without giving SDK core any scoring knowledge. The producer is a
// bare detector id (it becomes a service actor); callers may override the actor
// and attach normalized risk signals.
type SecurityRiskAssessedEventInput struct {
	OccurredAt        string
	Scope             EvidenceScope
	ProducerID        string
	Actor             *Principal
	Subject           EvidenceRef
	Conclusion        RiskConclusion
	Factors           []RiskFactor
	RiskSignals       *RiskSignals
	ActivityEpisodeID string
	Metadata          map[string]any
}

// BuildSecurityRiskAssessedEvent builds a security.risk.assessed audit event
// input threaded to its activity episode, byte-aligned with the TypeScript and
// Python buildSecurityRiskAssessedEvent (the cross-SDK canonical shape). The
// subject becomes the event target; the producer becomes a service actor whose id
// is the BARE producerId (never authority-qualified); the conclusion rides as a
// single metadata.riskAssessment object (factors included only when supplied);
// optional normalized signals ride at metadata.riskSignals; and activityEpisodeId
// is stamped via MergeVeritioMetadata AFTER caller metadata so a caller can never
// shadow the reserved episode join key. It fails closed on an invalid conclusion
// (non-finite or out-of-[0,1] score, or an unknown level) so a malformed score can
// never ride into event metadata. The result is an AuditEventInput; the host
// passes it to CreateAuditEvent for redaction and hashing.
func BuildSecurityRiskAssessedEvent(input SecurityRiskAssessedEventInput) (AuditEventInput, error) {
	if input.Scope.TenantID == "" {
		return AuditEventInput{}, errors.New("scope.tenantId is required")
	}
	if input.ProducerID == "" {
		return AuditEventInput{}, errors.New("producerId is required")
	}
	if err := assertEvidenceRef(input.Subject); err != nil {
		return AuditEventInput{}, err
	}
	if err := validateRiskConclusion(input.Conclusion); err != nil {
		return AuditEventInput{}, err
	}
	base := map[string]any{}
	if input.RiskSignals != nil {
		stamped, err := WithRiskSignals(input.Metadata, *input.RiskSignals)
		if err != nil {
			return AuditEventInput{}, err
		}
		base = stamped
	} else {
		for key, value := range input.Metadata {
			base[key] = value
		}
	}
	riskAssessment := map[string]any{
		"score":         input.Conclusion.Score,
		"level":         input.Conclusion.Level,
		"policyVersion": input.Conclusion.PolicyVersion,
		"assessment":    input.Conclusion.Assessment,
	}
	if input.Factors != nil {
		riskAssessment["factors"] = factorsMetadata(input.Factors)
	}
	base["riskAssessment"] = riskAssessment
	context := map[string]any{}
	if input.ActivityEpisodeID != "" {
		context["activityEpisodeId"] = input.ActivityEpisodeID
	}
	metadata, err := MergeVeritioMetadata(base, context)
	if err != nil {
		return AuditEventInput{}, err
	}
	actor := Principal{Type: "service", ID: input.ProducerID}
	if input.Actor != nil {
		actor = *input.Actor
	}
	event := AuditEventInput{
		Actor:    actor,
		Action:   "security.risk.assessed",
		Target:   Resource{Type: input.Subject.Type, ID: input.Subject.ID},
		Scope:    &input.Scope,
		Metadata: metadata,
	}
	if input.OccurredAt != "" {
		event.OccurredAt = input.OccurredAt
	}
	return event, nil
}

// factorsMetadata renders ordered risk factors as JSON-domain maps for audit
// metadata.
func factorsMetadata(factors []RiskFactor) []any {
	out := make([]any, len(factors))
	for index, factor := range factors {
		out[index] = map[string]any{
			"key":          factor.Key,
			"value":        factor.Value,
			"kind":         factor.Kind,
			"weight":       factor.Weight,
			"contribution": factor.Contribution,
		}
	}
	return out
}
