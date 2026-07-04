/**
 * Temperature-derived risk policies. Like ./risk-score this is language-neutral
 * protocol math (ports in sdks/python/src/veritio/risk.py and sdks/go/
 * risk_policy.go must stay byte-identical) and is CRYPTO-FREE so it ships in
 * the browser-safe `@veritio/core/risk-score` subpath. Derivation uses ONLY
 * two-segment linear interpolation + round4 (never pow/exp/log); the endpoint
 * constants below are pinned by spec/conformance/risk-policy-temperature.json.
 */

import {
  DEFAULT_RISK_POLICY,
  type EpisodeFrequencyRule,
  type RiskEnvCriticality,
  type RiskOperationType,
  type RiskReversibility,
  type RiskScoringPolicy,
  round4,
} from "./risk-score.js";

/**
 * Caller-supplied partial policy applied AFTER temperature derivation. Any
 * override makes the policy hand-tuned, so `policyVersion` becomes mandatory:
 * an auto "+tempX.XX" suffix must never misrepresent overridden constants in a
 * hashed conclusion. `rollup.frequencyRules` replaces wholesale (never merged).
 */
export interface RiskPolicyOverrides {
  policyVersion?: string;
  operationBase?: Partial<Record<RiskOperationType, number>>;
  reversibilityFactor?: Partial<Record<RiskReversibility, number>>;
  envCriticalityFactor?: Partial<Record<RiskEnvCriticality, number>>;
  magnitude?: {
    maxBoost?: number;
    weights?: Partial<RiskScoringPolicy["magnitude"]["weights"]>;
    k?: Partial<RiskScoringPolicy["magnitude"]["k"]>;
  };
  bands?: Partial<RiskScoringPolicy["bands"]>;
  rollup?: {
    windowSeconds?: number;
    decayPerWindow?: number;
    velocityNormalizer?: number;
    frequencyRules?: EpisodeFrequencyRule[];
  };
}

/** Options for riskPolicy(): a temperature knob and/or explicit overrides. */
export interface RiskPolicyOptions {
  temperature?: number;
  overrides?: RiskPolicyOverrides;
}

/**
 * Pinned lenient(t=0)/reference(t=0.5)/strict(t=1) endpoints for every
 * temperature-scaled field. The reference column repeats DEFAULT_RISK_POLICY so
 * t=0.5 reproduces the reference constants exactly; both extreme columns keep
 * bands strictly ascending and every factor positive. These numbers are a
 * cross-language protocol contract — changing any of them must update Python,
 * Go, and spec/conformance/risk-policy-temperature.json together.
 */
const TEMPERATURE_ENDPOINTS = {
  bandsLow: { lenient: 0.1, reference: 0.05, strict: 0.02 },
  bandsMedium: { lenient: 0.35, reference: 0.25, strict: 0.18 },
  bandsHigh: { lenient: 0.6, reference: 0.5, strict: 0.4 },
  bandsCritical: { lenient: 0.85, reference: 0.75, strict: 0.65 },
  decayPerWindow: { lenient: 0.3, reference: 0.5, strict: 0.7 },
  velocityNormalizer: { lenient: 4.0, reference: 3.0, strict: 2.0 },
  maxBoost: { lenient: 0.25, reference: 0.4, strict: 0.6 },
  irreversibleFactor: { lenient: 1.15, reference: 1.3, strict: 1.6 },
  productionFactor: { lenient: 0.9, reference: 1.0, strict: 1.2 },
} as const;

/**
 * Two-segment linear interpolation between the lenient/reference/strict
 * endpoints: t in [0,0.5] blends lenient->reference, t in [0.5,1] blends
 * reference->strict, so t=0.5 lands exactly on the reference value. round4 on
 * the result keeps TS/Python/Go byte-identical (no pow/exp anywhere).
 */
function lerpTemperature(endpoint: { lenient: number; reference: number; strict: number }, t: number): number {
  if (t <= 0.5) {
    return round4(endpoint.lenient + (endpoint.reference - endpoint.lenient) * (t / 0.5));
  }
  return round4(endpoint.reference + (endpoint.strict - endpoint.reference) * ((t - 0.5) / 0.5));
}

/**
 * Validates temperature fail-closed and converts it to integer hundredths, the
 * only representation used for the derived policyVersion string. Rejects
 * non-finite values, values outside [0,1], and anything that is not a multiple
 * of 0.01, so float formatting can never diverge across languages.
 */
function temperatureHundredths(temperature: number): number {
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new TypeError("temperature must be a finite number in [0,1]");
  }
  const hundredths = Math.round(temperature * 100);
  if (Math.abs(temperature * 100 - hundredths) > 1e-9) {
    throw new TypeError("temperature must be a multiple of 0.01");
  }
  return hundredths;
}

/**
 * Builds the derived policyVersion suffix from integer hundredths only (never
 * float formatting): 70 -> "veritio.reference.v1+temp0.70". Pure integer
 * division/modulo plus zero-padded concatenation is byte-identical across
 * TS/Python/Go.
 */
function temperatureVersion(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  const padded = frac < 10 ? `0${frac}` : `${frac}`;
  return `${DEFAULT_RISK_POLICY.policyVersion}+temp${whole}.${padded}`;
}

/**
 * Fail-closed structural check on the final policy (after derivation and any
 * overrides): every numeric leaf finite, bands strictly ascending, positive
 * factors/normalizers, windowSeconds > 0. Guards against a future endpoint
 * retune or a caller override producing a policy the banding math cannot
 * honor; violations throw instead of silently mis-banding scores.
 */
function assertDerivedPolicy(policy: RiskScoringPolicy): void {
  const numericLeaves: number[] = [
    ...Object.values(policy.operationBase),
    ...Object.values(policy.reversibilityFactor),
    ...Object.values(policy.envCriticalityFactor),
    policy.magnitude.maxBoost,
    ...Object.values(policy.magnitude.weights),
    ...Object.values(policy.magnitude.k),
    ...Object.values(policy.bands),
    policy.rollup.windowSeconds,
    policy.rollup.decayPerWindow,
    policy.rollup.velocityNormalizer,
  ];
  if (numericLeaves.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new TypeError("policy numeric fields must all be finite numbers");
  }
  const { low, medium, high, critical } = policy.bands;
  if (!(low < medium && medium < high && high < critical)) {
    throw new TypeError("policy bands must be strictly ascending");
  }
  const factors = [...Object.values(policy.reversibilityFactor), ...Object.values(policy.envCriticalityFactor)];
  if (factors.some((value) => value <= 0)) {
    throw new TypeError("policy multiplier factors must be greater than 0");
  }
  if (policy.rollup.windowSeconds <= 0 || policy.rollup.velocityNormalizer <= 0) {
    throw new TypeError("policy rollup windowSeconds and velocityNormalizer must be greater than 0");
  }
  if (typeof policy.policyVersion !== "string" || policy.policyVersion.length === 0) {
    throw new TypeError("policy policyVersion must be a non-empty string");
  }
}

/**
 * Returns true when the overrides object carries at least one override besides
 * nothing at all; used to enforce the override-requires-policyVersion rule.
 */
function hasOverrides(overrides: RiskPolicyOverrides | undefined): overrides is RiskPolicyOverrides {
  return overrides !== undefined && Object.keys(overrides).length > 0;
}

/**
 * Explicit deep-merge of overrides into a derived policy. Only documented
 * sub-objects are merged (one level into operationBase/factors/bands/rollup,
 * two levels into magnitude.weights/k); frequencyRules replaces wholesale.
 * Enumerating known keys instead of recursing keeps merging fail-closed:
 * unknown keys are ignored rather than smuggled into the policy shape.
 */
function mergeOverrides(base: RiskScoringPolicy, overrides: RiskPolicyOverrides): RiskScoringPolicy {
  if (typeof overrides.policyVersion !== "string" || overrides.policyVersion.length === 0) {
    throw new TypeError(
      "overrides.policyVersion is required when overriding policy fields so a hand-tuned policy is never misrepresented by a temperature version",
    );
  }
  return {
    policyVersion: overrides.policyVersion,
    operationBase: { ...base.operationBase, ...overrides.operationBase },
    reversibilityFactor: { ...base.reversibilityFactor, ...overrides.reversibilityFactor },
    envCriticalityFactor: { ...base.envCriticalityFactor, ...overrides.envCriticalityFactor },
    magnitude: {
      maxBoost: overrides.magnitude?.maxBoost ?? base.magnitude.maxBoost,
      weights: { ...base.magnitude.weights, ...overrides.magnitude?.weights },
      k: { ...base.magnitude.k, ...overrides.magnitude?.k },
    },
    bands: { ...base.bands, ...overrides.bands },
    rollup: {
      windowSeconds: overrides.rollup?.windowSeconds ?? base.rollup.windowSeconds,
      decayPerWindow: overrides.rollup?.decayPerWindow ?? base.rollup.decayPerWindow,
      velocityNormalizer: overrides.rollup?.velocityNormalizer ?? base.rollup.velocityNormalizer,
      frequencyRules: overrides.rollup?.frequencyRules ?? base.rollup.frequencyRules,
    },
  };
}

/**
 * Derives a full RiskScoringPolicy from DEFAULT_RISK_POLICY. `temperature`
 * (multiple of 0.01 in [0,1], 0.5 = the reference policy byte-for-byte,
 * lower = lenient, higher = strict) rescales only the pinned
 * TEMPERATURE_ENDPOINTS fields and stamps a deterministic
 * "veritio.reference.v1+tempX.XX" policyVersion. `overrides` deep-merge AFTER
 * derivation and require an explicit overrides.policyVersion (fail closed).
 * With no options at all this returns a fresh copy equal to
 * DEFAULT_RISK_POLICY. Never mutates DEFAULT_RISK_POLICY; pure and
 * deterministic so TS/Python/Go derive byte-identical policies, pinned by
 * spec/conformance/risk-policy-temperature.json.
 */
export function riskPolicy(options: RiskPolicyOptions = {}): RiskScoringPolicy {
  let derived: RiskScoringPolicy = {
    policyVersion: DEFAULT_RISK_POLICY.policyVersion,
    operationBase: { ...DEFAULT_RISK_POLICY.operationBase },
    reversibilityFactor: { ...DEFAULT_RISK_POLICY.reversibilityFactor },
    envCriticalityFactor: { ...DEFAULT_RISK_POLICY.envCriticalityFactor },
    magnitude: {
      maxBoost: DEFAULT_RISK_POLICY.magnitude.maxBoost,
      weights: { ...DEFAULT_RISK_POLICY.magnitude.weights },
      k: { ...DEFAULT_RISK_POLICY.magnitude.k },
    },
    bands: { ...DEFAULT_RISK_POLICY.bands },
    rollup: { ...DEFAULT_RISK_POLICY.rollup, frequencyRules: [...DEFAULT_RISK_POLICY.rollup.frequencyRules] },
  };

  if (options.temperature !== undefined) {
    const hundredths = temperatureHundredths(options.temperature);
    const t = options.temperature;
    derived.policyVersion = temperatureVersion(hundredths);
    derived.bands = {
      low: lerpTemperature(TEMPERATURE_ENDPOINTS.bandsLow, t),
      medium: lerpTemperature(TEMPERATURE_ENDPOINTS.bandsMedium, t),
      high: lerpTemperature(TEMPERATURE_ENDPOINTS.bandsHigh, t),
      critical: lerpTemperature(TEMPERATURE_ENDPOINTS.bandsCritical, t),
    };
    derived.rollup.decayPerWindow = lerpTemperature(TEMPERATURE_ENDPOINTS.decayPerWindow, t);
    derived.rollup.velocityNormalizer = lerpTemperature(TEMPERATURE_ENDPOINTS.velocityNormalizer, t);
    derived.magnitude.maxBoost = lerpTemperature(TEMPERATURE_ENDPOINTS.maxBoost, t);
    derived.reversibilityFactor.irreversible = lerpTemperature(TEMPERATURE_ENDPOINTS.irreversibleFactor, t);
    derived.envCriticalityFactor.production = lerpTemperature(TEMPERATURE_ENDPOINTS.productionFactor, t);
  }

  if (hasOverrides(options.overrides)) {
    derived = mergeOverrides(derived, options.overrides);
  }

  assertDerivedPolicy(derived);
  return derived;
}
