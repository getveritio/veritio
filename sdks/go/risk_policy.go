package veritio

import (
	"errors"
	"fmt"
	"math"
)

// EpisodeFrequencyRule is one sliding-window frequency rule. It fires at most
// once per episode when the count of qualifying steps (action exact-matches one
// of Actions) inside any WindowSeconds window reaches Threshold; a fired rule
// contributes Boost to the episode frequencyScore. Rules can only raise an
// episode score, never lower it, because frequencyScore joins the final max().
type EpisodeFrequencyRule struct {
	Actions       []string `json:"actions"`
	WindowSeconds float64  `json:"windowSeconds"`
	Threshold     float64  `json:"threshold"`
	Boost         float64  `json:"boost"`
}

// FrequencyRuleMatch is the explainability record for one configured frequency
// rule (fired or not). Count is the max qualifying-step count observed in any
// window; Boost is the applied boost (0 when the rule did not fire).
type FrequencyRuleMatch struct {
	Actions       []string `json:"actions"`
	WindowSeconds float64  `json:"windowSeconds"`
	Threshold     float64  `json:"threshold"`
	Count         int      `json:"count"`
	Fired         bool     `json:"fired"`
	Boost         float64  `json:"boost"`
}

// Float64 returns a pointer to v, a convenience for populating the optional
// pointer fields of RiskPolicyOptions/RiskPolicyOverrides (which use pointers to
// distinguish an absent field from a legitimate zero value).
func Float64(v float64) *float64 {
	return &v
}

// RiskMagnitudeComponentsOverride is a partial override of the per-signal weight
// or saturation constants; nil fields keep the derived/base value.
type RiskMagnitudeComponentsOverride struct {
	DataVolume     *float64 `json:"dataVolume,omitempty"`
	FanOut         *float64 `json:"fanOut,omitempty"`
	ReferenceCount *float64 `json:"referenceCount,omitempty"`
}

// RiskMagnitudeOverride is a partial override of the magnitude policy; nil fields
// keep the derived/base value and Weights/K merge component-by-component.
type RiskMagnitudeOverride struct {
	MaxBoost *float64                         `json:"maxBoost,omitempty"`
	Weights  *RiskMagnitudeComponentsOverride `json:"weights,omitempty"`
	K        *RiskMagnitudeComponentsOverride `json:"k,omitempty"`
}

// RiskBandsOverride is a partial override of the risk bands; nil fields keep the
// derived/base value.
type RiskBandsOverride struct {
	Low      *float64 `json:"low,omitempty"`
	Medium   *float64 `json:"medium,omitempty"`
	High     *float64 `json:"high,omitempty"`
	Critical *float64 `json:"critical,omitempty"`
}

// RiskRollupOverride is a partial override of the rollup policy; nil scalar
// fields keep the derived/base value. A non-nil FrequencyRules replaces the rule
// set wholesale (never merged); nil keeps the derived/base rules.
type RiskRollupOverride struct {
	WindowSeconds      *float64               `json:"windowSeconds,omitempty"`
	DecayPerWindow     *float64               `json:"decayPerWindow,omitempty"`
	VelocityNormalizer *float64               `json:"velocityNormalizer,omitempty"`
	FrequencyRules     []EpisodeFrequencyRule `json:"frequencyRules,omitempty"`
}

// RiskPolicyOverrides is a caller-supplied partial policy applied AFTER
// temperature derivation. Any override makes the policy hand-tuned, so
// PolicyVersion becomes mandatory: an auto "+tempX.XX" suffix must never
// misrepresent overridden constants in a hashed conclusion. Map fields merge
// key-by-key; frequencyRules replaces wholesale.
type RiskPolicyOverrides struct {
	PolicyVersion        string                 `json:"policyVersion,omitempty"`
	OperationBase        map[string]float64     `json:"operationBase,omitempty"`
	ReversibilityFactor  map[string]float64     `json:"reversibilityFactor,omitempty"`
	EnvCriticalityFactor map[string]float64     `json:"envCriticalityFactor,omitempty"`
	Magnitude            *RiskMagnitudeOverride `json:"magnitude,omitempty"`
	Bands                *RiskBandsOverride     `json:"bands,omitempty"`
	Rollup               *RiskRollupOverride    `json:"rollup,omitempty"`
}

// RiskPolicyOptions carries the temperature knob and/or explicit overrides for
// RiskPolicy. Temperature is a pointer so an absent knob is distinguishable from
// a deliberate 0.0 (which derives the lenient endpoints).
type RiskPolicyOptions struct {
	Temperature *float64             `json:"temperature,omitempty"`
	Overrides   *RiskPolicyOverrides `json:"overrides,omitempty"`
}

// assertFrequencyRules validates configured frequency rules before any scoring
// runs. It fails closed on malformed rules (empty/blank action lists, non-finite
// or non-positive windows, fractional or sub-1 thresholds, negative or non-finite
// boosts) so a corrupt rule can never silently disable or skew burst detection.
func assertFrequencyRules(rules []EpisodeFrequencyRule) error {
	for _, rule := range rules {
		if len(rule.Actions) == 0 {
			return errors.New("frequencyRules[].actions must be a non-empty array of non-empty strings")
		}
		for _, action := range rule.Actions {
			if action == "" {
				return errors.New("frequencyRules[].actions must be a non-empty array of non-empty strings")
			}
		}
		if math.IsNaN(rule.WindowSeconds) || math.IsInf(rule.WindowSeconds, 0) || rule.WindowSeconds <= 0 {
			return errors.New("frequencyRules[].windowSeconds must be a finite number greater than 0")
		}
		if math.IsNaN(rule.Threshold) || math.IsInf(rule.Threshold, 0) || rule.Threshold != math.Floor(rule.Threshold) || rule.Threshold < 1 {
			return errors.New("frequencyRules[].threshold must be an integer greater than or equal to 1")
		}
		if math.IsNaN(rule.Boost) || math.IsInf(rule.Boost, 0) || rule.Boost < 0 {
			return errors.New("frequencyRules[].boost must be a finite number greater than or equal to 0")
		}
	}
	return nil
}

// evaluateFrequencyRules evaluates every configured rule against the time-sorted
// steps using an inclusive two-pointer sliding window (endMs - startMs <=
// windowSeconds*1000) over the steps whose action exact-matches the rule. Each
// rule fires at most once; frequencyScore is the clamped round4 sum of fired
// boosts. Pure integer/compare math so TS/Python/Go agree byte-for-byte.
func evaluateFrequencyRules(ordered []orderedStep, rules []EpisodeFrequencyRule) (float64, []FrequencyRuleMatch) {
	boostSum := 0.0
	matches := make([]FrequencyRuleMatch, len(rules))
	for index, rule := range rules {
		timesMs := make([]int64, 0, len(ordered))
		for _, step := range ordered {
			if step.action != "" && actionMatches(rule.Actions, step.action) {
				timesMs = append(timesMs, step.at.UnixMilli())
			}
		}
		maxCount := 0
		start := 0
		for end := 0; end < len(timesMs); end++ {
			for float64(timesMs[end]-timesMs[start]) > rule.WindowSeconds*1000 {
				start++
			}
			count := end - start + 1
			if count > maxCount {
				maxCount = count
			}
		}
		fired := maxCount >= int(rule.Threshold)
		boost := 0.0
		if fired {
			boost = rule.Boost
			boostSum += rule.Boost
		}
		matches[index] = FrequencyRuleMatch{
			Actions:       append([]string(nil), rule.Actions...),
			WindowSeconds: rule.WindowSeconds,
			Threshold:     rule.Threshold,
			Count:         maxCount,
			Fired:         fired,
			Boost:         boost,
		}
	}
	return clamp01(round4(boostSum)), matches
}

// actionMatches reports whether action exact-matches one of the rule actions.
func actionMatches(actions []string, action string) bool {
	for _, candidate := range actions {
		if candidate == action {
			return true
		}
	}
	return false
}

// lerpTemperature is the two-segment linear interpolation between the
// lenient/reference/strict endpoints: t in [0,0.5] blends lenient->reference,
// t in [0.5,1] blends reference->strict, so t=0.5 lands exactly on reference.
// round4 keeps TS/Python/Go byte-identical; the operation order is fixed.
func lerpTemperature(lenient float64, reference float64, strict float64, t float64) float64 {
	if t <= 0.5 {
		return round4(lenient + (reference-lenient)*(t/0.5))
	}
	return round4(reference + (strict-reference)*((t-0.5)/0.5))
}

// temperatureHundredths validates temperature fail-closed and converts it to
// integer hundredths, the only representation used for the derived policyVersion.
// It rejects non-finite values, values outside [0,1], and anything not a multiple
// of 0.01, so float formatting can never diverge across languages.
func temperatureHundredths(temperature float64) (int, error) {
	if math.IsNaN(temperature) || math.IsInf(temperature, 0) || temperature < 0 || temperature > 1 {
		return 0, errors.New("temperature must be a finite number in [0,1]")
	}
	hundredths := int(math.Round(temperature * 100))
	if math.Abs(temperature*100-float64(hundredths)) > 1e-9 {
		return 0, errors.New("temperature must be a multiple of 0.01")
	}
	return hundredths, nil
}

// temperatureVersion builds the derived policyVersion suffix from integer
// hundredths only (never float formatting): 70 -> "veritio.reference.v1+temp0.70".
// Pure integer division/modulo plus zero-padding is byte-identical across SDKs.
func temperatureVersion(hundredths int) string {
	whole := hundredths / 100
	frac := hundredths % 100
	return fmt.Sprintf("%s+temp%d.%02d", DefaultRiskPolicy.PolicyVersion, whole, frac)
}

// assertDerivedPolicy is the fail-closed structural check on the final policy
// (after derivation and any overrides): every numeric leaf finite, bands strictly
// ascending, positive multiplier factors, windowSeconds/velocityNormalizer > 0,
// non-empty policyVersion. It guards against an endpoint retune or a caller
// override producing a policy the banding math cannot honor.
func assertDerivedPolicy(policy RiskScoringPolicy) error {
	numericLeaves := make([]float64, 0, 24)
	for _, value := range policy.OperationBase {
		numericLeaves = append(numericLeaves, value)
	}
	for _, value := range policy.ReversibilityFactor {
		numericLeaves = append(numericLeaves, value)
	}
	for _, value := range policy.EnvCriticalityFactor {
		numericLeaves = append(numericLeaves, value)
	}
	numericLeaves = append(numericLeaves,
		policy.Magnitude.MaxBoost,
		policy.Magnitude.Weights.DataVolume, policy.Magnitude.Weights.FanOut, policy.Magnitude.Weights.ReferenceCount,
		policy.Magnitude.K.DataVolume, policy.Magnitude.K.FanOut, policy.Magnitude.K.ReferenceCount,
		policy.Bands.Low, policy.Bands.Medium, policy.Bands.High, policy.Bands.Critical,
		policy.Rollup.WindowSeconds, policy.Rollup.DecayPerWindow, policy.Rollup.VelocityNormalizer,
	)
	for _, value := range numericLeaves {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return errors.New("policy numeric fields must all be finite numbers")
		}
	}
	bands := policy.Bands
	if !(bands.Low < bands.Medium && bands.Medium < bands.High && bands.High < bands.Critical) {
		return errors.New("policy bands must be strictly ascending")
	}
	for _, value := range policy.ReversibilityFactor {
		if value <= 0 {
			return errors.New("policy multiplier factors must be greater than 0")
		}
	}
	for _, value := range policy.EnvCriticalityFactor {
		if value <= 0 {
			return errors.New("policy multiplier factors must be greater than 0")
		}
	}
	if policy.Rollup.WindowSeconds <= 0 || policy.Rollup.VelocityNormalizer <= 0 {
		return errors.New("policy rollup windowSeconds and velocityNormalizer must be greater than 0")
	}
	if policy.PolicyVersion == "" {
		return errors.New("policy policyVersion must be a non-empty string")
	}
	return nil
}

// copyFloatMap returns a fresh copy of m so a derived policy never mutates the
// shared DefaultRiskPolicy maps.
func copyFloatMap(source map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}

// mergeFloatMap returns a fresh copy of base overlaid with override's keys,
// mirroring the TS spread {...base, ...override}.
func mergeFloatMap(base map[string]float64, override map[string]float64) map[string]float64 {
	out := copyFloatMap(base)
	for key, value := range override {
		out[key] = value
	}
	return out
}

// mergeComponents overlays a partial component override onto base; nil override
// fields keep the base value.
func mergeComponents(base RiskMagnitudeComponents, override *RiskMagnitudeComponentsOverride) RiskMagnitudeComponents {
	if override == nil {
		return base
	}
	if override.DataVolume != nil {
		base.DataVolume = *override.DataVolume
	}
	if override.FanOut != nil {
		base.FanOut = *override.FanOut
	}
	if override.ReferenceCount != nil {
		base.ReferenceCount = *override.ReferenceCount
	}
	return base
}

// hasOverrides reports whether the overrides struct carries at least one
// override. It mirrors TS hasOverrides (Object.keys length) and Python's
// len(overrides) > 0 gate so an empty-but-present overrides object is a no-op
// in all three languages instead of failing the mandatory-policyVersion check
// only in Go.
func hasOverrides(overrides *RiskPolicyOverrides) bool {
	if overrides == nil {
		return false
	}
	return overrides.PolicyVersion != "" ||
		overrides.OperationBase != nil ||
		overrides.ReversibilityFactor != nil ||
		overrides.EnvCriticalityFactor != nil ||
		overrides.Magnitude != nil ||
		overrides.Bands != nil ||
		overrides.Rollup != nil
}

// mergeOverrides deep-merges overrides into a derived policy. Only documented
// sub-objects are merged; frequencyRules replaces wholesale. Enumerating known
// keys keeps merging fail-closed and requires an explicit policyVersion so a
// hand-tuned policy is never misrepresented by a temperature version.
func mergeOverrides(base RiskScoringPolicy, overrides RiskPolicyOverrides) (RiskScoringPolicy, error) {
	if overrides.PolicyVersion == "" {
		return RiskScoringPolicy{}, errors.New("overrides.policyVersion is required when overriding policy fields so a hand-tuned policy is never misrepresented by a temperature version")
	}
	merged := RiskScoringPolicy{
		PolicyVersion:        overrides.PolicyVersion,
		OperationBase:        mergeFloatMap(base.OperationBase, overrides.OperationBase),
		ReversibilityFactor:  mergeFloatMap(base.ReversibilityFactor, overrides.ReversibilityFactor),
		EnvCriticalityFactor: mergeFloatMap(base.EnvCriticalityFactor, overrides.EnvCriticalityFactor),
		Magnitude:            base.Magnitude,
		Bands:                base.Bands,
		Rollup: RiskRollupPolicy{
			WindowSeconds:      base.Rollup.WindowSeconds,
			DecayPerWindow:     base.Rollup.DecayPerWindow,
			VelocityNormalizer: base.Rollup.VelocityNormalizer,
			FrequencyRules:     append([]EpisodeFrequencyRule(nil), base.Rollup.FrequencyRules...),
		},
	}
	if overrides.Magnitude != nil {
		if overrides.Magnitude.MaxBoost != nil {
			merged.Magnitude.MaxBoost = *overrides.Magnitude.MaxBoost
		}
		merged.Magnitude.Weights = mergeComponents(merged.Magnitude.Weights, overrides.Magnitude.Weights)
		merged.Magnitude.K = mergeComponents(merged.Magnitude.K, overrides.Magnitude.K)
	}
	if overrides.Bands != nil {
		if overrides.Bands.Low != nil {
			merged.Bands.Low = *overrides.Bands.Low
		}
		if overrides.Bands.Medium != nil {
			merged.Bands.Medium = *overrides.Bands.Medium
		}
		if overrides.Bands.High != nil {
			merged.Bands.High = *overrides.Bands.High
		}
		if overrides.Bands.Critical != nil {
			merged.Bands.Critical = *overrides.Bands.Critical
		}
	}
	if overrides.Rollup != nil {
		if overrides.Rollup.WindowSeconds != nil {
			merged.Rollup.WindowSeconds = *overrides.Rollup.WindowSeconds
		}
		if overrides.Rollup.DecayPerWindow != nil {
			merged.Rollup.DecayPerWindow = *overrides.Rollup.DecayPerWindow
		}
		if overrides.Rollup.VelocityNormalizer != nil {
			merged.Rollup.VelocityNormalizer = *overrides.Rollup.VelocityNormalizer
		}
		if overrides.Rollup.FrequencyRules != nil {
			merged.Rollup.FrequencyRules = append([]EpisodeFrequencyRule(nil), overrides.Rollup.FrequencyRules...)
		}
	}
	return merged, nil
}

// RiskPolicy derives a full RiskScoringPolicy from DefaultRiskPolicy. Temperature
// (a multiple of 0.01 in [0,1], 0.5 = the reference policy byte-for-byte, lower =
// lenient, higher = strict) rescales only the pinned endpoint fields and stamps a
// deterministic "veritio.reference.v1+tempX.XX" policyVersion. Overrides deep-merge
// AFTER derivation and require an explicit overrides.PolicyVersion (fail closed).
// With no options it returns a fresh copy equal to DefaultRiskPolicy. It never
// mutates DefaultRiskPolicy and is pure/deterministic so TS/Python/Go derive
// byte-identical policies, pinned by spec/conformance/risk-policy-temperature.json.
//
// The lenient/reference/strict endpoints inlined below are a cross-language
// protocol contract; changing any of them must update Python, TypeScript, and the
// fixtures together.
func RiskPolicy(options RiskPolicyOptions) (RiskScoringPolicy, error) {
	derived := RiskScoringPolicy{
		PolicyVersion:        DefaultRiskPolicy.PolicyVersion,
		OperationBase:        copyFloatMap(DefaultRiskPolicy.OperationBase),
		ReversibilityFactor:  copyFloatMap(DefaultRiskPolicy.ReversibilityFactor),
		EnvCriticalityFactor: copyFloatMap(DefaultRiskPolicy.EnvCriticalityFactor),
		Magnitude: RiskMagnitudePolicy{
			MaxBoost: DefaultRiskPolicy.Magnitude.MaxBoost,
			Weights:  DefaultRiskPolicy.Magnitude.Weights,
			K:        DefaultRiskPolicy.Magnitude.K,
		},
		Bands: DefaultRiskPolicy.Bands,
		Rollup: RiskRollupPolicy{
			WindowSeconds:      DefaultRiskPolicy.Rollup.WindowSeconds,
			DecayPerWindow:     DefaultRiskPolicy.Rollup.DecayPerWindow,
			VelocityNormalizer: DefaultRiskPolicy.Rollup.VelocityNormalizer,
			FrequencyRules:     append([]EpisodeFrequencyRule(nil), DefaultRiskPolicy.Rollup.FrequencyRules...),
		},
	}

	if options.Temperature != nil {
		t := *options.Temperature
		hundredths, err := temperatureHundredths(t)
		if err != nil {
			return RiskScoringPolicy{}, err
		}
		derived.PolicyVersion = temperatureVersion(hundredths)
		derived.Bands = RiskBands{
			Low:      lerpTemperature(0.1, 0.05, 0.02, t),
			Medium:   lerpTemperature(0.35, 0.25, 0.18, t),
			High:     lerpTemperature(0.6, 0.5, 0.4, t),
			Critical: lerpTemperature(0.85, 0.75, 0.65, t),
		}
		derived.Rollup.DecayPerWindow = lerpTemperature(0.3, 0.5, 0.7, t)
		derived.Rollup.VelocityNormalizer = lerpTemperature(4.0, 3.0, 2.0, t)
		derived.Magnitude.MaxBoost = lerpTemperature(0.25, 0.4, 0.6, t)
		derived.ReversibilityFactor["irreversible"] = lerpTemperature(1.15, 1.3, 1.6, t)
		derived.EnvCriticalityFactor["production"] = lerpTemperature(0.9, 1.0, 1.2, t)
	}

	if hasOverrides(options.Overrides) {
		merged, err := mergeOverrides(derived, *options.Overrides)
		if err != nil {
			return RiskScoringPolicy{}, err
		}
		derived = merged
	}

	if err := assertDerivedPolicy(derived); err != nil {
		return RiskScoringPolicy{}, err
	}
	return derived, nil
}
