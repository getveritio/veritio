/**
 * Pure risk-scoring math for the Veritio evidence layer. This module is
 * language-neutral protocol math: it must stay byte-identical across the
 * TypeScript, Python, and Go SDKs, so it uses ONLY clamp/floor/divide/multiply
 * (never pow/exp/log) and pins every constant in DEFAULT_RISK_POLICY.
 *
 * It is intentionally CRYPTO-FREE and has NO runtime dependency on `./index` or
 * `./governed-change`, so it is safe to import into a browser/edge bundle (e.g.
 * to derive a display score on read) without dragging `node:crypto` in. The
 * crypto-dependent assertion builders live in `./risk` and re-export this module,
 * so the public `@veritio/core` surface is unchanged; browser consumers import
 * the pure math directly via the `@veritio/core/risk-score` subpath.
 */

/** Operation classes that seed per-step base risk; protocol-fixed string values. */
export type RiskOperationType =
  | "read"
  | "create"
  | "update"
  | "config"
  | "bulk"
  | "permission"
  | "delete"
  | "destructive";

/** How recoverable an operation is; scales the per-step score multiplicatively. */
export type RiskReversibility = "reversible" | "recoverable" | "irreversible";

/** Deployment criticality; scales the per-step score multiplicatively. */
export type RiskEnvCriticality = "sandbox" | "development" | "staging" | "production";

/** Caller-supplied signals for one operation. Magnitudes are non-negative ints. */
export interface RiskSignals {
  operationType: RiskOperationType;
  reversibility?: RiskReversibility;
  envCriticality?: RiskEnvCriticality;
  dataVolume?: number;
  fanOut?: number;
  referenceCount?: number;
}

/** Banded risk level derived from a 0..1 score. */
export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

/** One explainable contributor to a score (base seed, additive boost, or multiplier). */
export interface RiskFactor {
  key: string;
  value: number | string;
  kind: "base" | "additive" | "multiplier";
  weight: number;
  contribution: number;
}

/** Result of scoring a single step, with the full factor breakdown for explainability. */
export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  policyVersion: string;
  factors: RiskFactor[];
}

/**
 * One step of an episode rollup. `action` is an optional freeform dotted event
 * action (e.g. "auth.login.failed") used ONLY by frequency-rule matching; steps
 * without it never match a rule, which keeps pre-rule callers byte-identical.
 */
export interface EpisodeRiskStep {
  occurredAt: string;
  score: number;
  action?: string;
}

/**
 * One sliding-window frequency rule. Fires at most once per episode when the
 * count of qualifying steps (action exact-matches one of `actions`) inside any
 * `windowSeconds` window reaches `threshold`; a fired rule contributes `boost`
 * to the episode frequencyScore. Rules can only raise an episode score, never
 * lower it, because frequencyScore joins the final max().
 */
export interface EpisodeFrequencyRule {
  actions: string[];
  windowSeconds: number;
  threshold: number;
  boost: number;
}

/** Explainability record for one configured frequency rule (fired or not). */
export interface FrequencyRuleMatch {
  actions: string[];
  windowSeconds: number;
  threshold: number;
  count: number;
  fired: boolean;
  boost: number;
}

/**
 * Result of rolling many steps into one episode-level risk summary. The
 * frequency fields are present ONLY when the policy configures at least one
 * frequency rule, so rollups under rule-free policies stay byte-identical to
 * the pre-frequency protocol output.
 */
export interface EpisodeRiskRollup {
  score: number;
  level: RiskLevel;
  peak: number;
  velocityScore: number;
  stepCount: number;
  policyVersion: string;
  frequencyScore?: number;
  frequencyMatches?: FrequencyRuleMatch[];
}

/** Tunable policy. Hosted products may retune values; the math shape is fixed. */
export interface RiskScoringPolicy {
  policyVersion: string;
  operationBase: Record<RiskOperationType, number>;
  reversibilityFactor: Record<RiskReversibility, number>;
  envCriticalityFactor: Record<RiskEnvCriticality, number>;
  magnitude: {
    maxBoost: number;
    weights: { dataVolume: number; fanOut: number; referenceCount: number };
    k: { dataVolume: number; fanOut: number; referenceCount: number };
  };
  bands: { low: number; medium: number; high: number; critical: number };
  rollup: {
    windowSeconds: number;
    decayPerWindow: number;
    velocityNormalizer: number;
    frequencyRules: EpisodeFrequencyRule[];
  };
}

/**
 * Reference scoring policy. These exact constants are the cross-language
 * contract pinned by the spec/conformance fixtures; changing any value is a
 * protocol change and must update Python, Go, and the fixtures together.
 */
export const DEFAULT_RISK_POLICY: RiskScoringPolicy = {
  policyVersion: "veritio.reference.v1",
  operationBase: {
    read: 0.05,
    create: 0.2,
    update: 0.3,
    config: 0.45,
    bulk: 0.55,
    permission: 0.6,
    delete: 0.7,
    destructive: 0.85,
  },
  reversibilityFactor: {
    reversible: 0.6,
    recoverable: 1.0,
    irreversible: 1.3,
  },
  envCriticalityFactor: {
    sandbox: 0.4,
    development: 0.6,
    staging: 0.8,
    production: 1.0,
  },
  magnitude: {
    maxBoost: 0.4,
    weights: { dataVolume: 0.5, fanOut: 0.3, referenceCount: 0.2 },
    k: { dataVolume: 100, fanOut: 25, referenceCount: 50 },
  },
  bands: { low: 0.05, medium: 0.25, high: 0.5, critical: 0.75 },
  rollup: { windowSeconds: 60, decayPerWindow: 0.5, velocityNormalizer: 3.0, frequencyRules: [] },
};

/**
 * Clamps to the inclusive [0,1] unit interval. A single out-of-range factor can
 * never push a published score past the protocol's documented bounds.
 */
export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Rounds half-up to four decimals using only floor + integer arithmetic. NO
 * pow/exp/log so TypeScript, Python, and Go emit byte-identical scores.
 */
export function round4(x: number): number {
  return Math.floor(x * 10000 + 0.5) / 10000;
}

/**
 * Saturating magnitude curve x/(x+K): 0 at zero, asymptotic to 1, no exp/log so
 * large counts add boost without ever exceeding the configured maxBoost. K is
 * always a positive policy constant, so x=0 yields exactly 0.
 */
export function sat(x: number, k: number): number {
  return x / (x + k);
}

/**
 * Maps a 0..1 score to a protocol risk band using half-open thresholds:
 * none below low, then low/medium/high, critical at-or-above the critical band.
 * Bands come from the policy so thresholds can be retuned without forking math.
 */
export function bandOf(score: number, bands: RiskScoringPolicy["bands"]): RiskLevel {
  if (score < bands.low) return "none";
  if (score < bands.medium) return "low";
  if (score < bands.high) return "medium";
  if (score < bands.critical) return "high";
  return "critical";
}

const RISK_OPERATION_TYPES: readonly RiskOperationType[] = [
  "read",
  "create",
  "update",
  "config",
  "bulk",
  "permission",
  "delete",
  "destructive",
];
const RISK_REVERSIBILITIES: readonly RiskReversibility[] = ["reversible", "recoverable", "irreversible"];
const RISK_ENV_CRITICALITIES: readonly RiskEnvCriticality[] = ["sandbox", "development", "staging", "production"];

/**
 * Validates one magnitude signal: undefined becomes 0, anything else must be a
 * finite non-negative integer. Fractional, negative, NaN, or Infinity values
 * fail closed so a corrupt count cannot quietly skew the saturating boost curve.
 */
function normalizeMagnitude(value: number | undefined, field: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value;
}

/**
 * Normalizes caller-supplied risk signals into a fully-populated, fail-closed
 * RiskSignals. Unknown enums or invalid magnitudes throw rather than silently
 * scoring low; absent enums default to the most conservative class
 * (recoverable/production) and absent magnitudes to 0 so an omitted signal can
 * never lower risk below an explicit zero. Does not mutate the input.
 */
export function normalizeRiskSignals(signals: RiskSignals): RiskSignals {
  if (!RISK_OPERATION_TYPES.includes(signals.operationType)) {
    throw new TypeError("operationType must be a known risk operation type");
  }
  const reversibility = signals.reversibility ?? "recoverable";
  if (!RISK_REVERSIBILITIES.includes(reversibility)) {
    throw new TypeError("reversibility must be a known risk reversibility class");
  }
  const envCriticality = signals.envCriticality ?? "production";
  if (!RISK_ENV_CRITICALITIES.includes(envCriticality)) {
    throw new TypeError("envCriticality must be a known environment criticality");
  }
  return {
    operationType: signals.operationType,
    reversibility,
    envCriticality,
    dataVolume: normalizeMagnitude(signals.dataVolume, "dataVolume"),
    fanOut: normalizeMagnitude(signals.fanOut, "fanOut"),
    referenceCount: normalizeMagnitude(signals.referenceCount, "referenceCount"),
  };
}

/**
 * Scores one step against the policy and returns the full factor breakdown.
 * Normalizes first (so invalid signals fail closed), then combines an
 * operation base with saturating additive boosts and reversibility/environment
 * multipliers using only round4/sat/clamp01 (no pow/exp/log). The factor order
 * and multiplier weight==contribution convention are part of the conformance
 * contract pinned by spec/conformance/risk-scoring-default-policy.json.
 */
export function scoreRiskSignals(
  signals: RiskSignals,
  policy: RiskScoringPolicy = DEFAULT_RISK_POLICY,
): RiskAssessment {
  const normalized = normalizeRiskSignals(signals);
  const operationType = normalized.operationType;
  const reversibility = normalized.reversibility ?? "recoverable";
  const envCriticality = normalized.envCriticality ?? "production";
  const dataVolume = normalized.dataVolume ?? 0;
  const fanOut = normalized.fanOut ?? 0;
  const referenceCount = normalized.referenceCount ?? 0;

  const base = policy.operationBase[operationType];
  const { maxBoost, weights, k } = policy.magnitude;
  const dvC = round4(maxBoost * weights.dataVolume * sat(dataVolume, k.dataVolume));
  const foC = round4(maxBoost * weights.fanOut * sat(fanOut, k.fanOut));
  const rcC = round4(maxBoost * weights.referenceCount * sat(referenceCount, k.referenceCount));

  const reversibilityFactor = policy.reversibilityFactor[reversibility];
  const envFactor = policy.envCriticalityFactor[envCriticality];

  const score = clamp01(round4((base + dvC + foC + rcC) * reversibilityFactor * envFactor));
  const level = bandOf(score, policy.bands);

  const factors: RiskFactor[] = [
    { key: "operationType", value: operationType, kind: "base", weight: 1, contribution: base },
    { key: "dataVolume", value: dataVolume, kind: "additive", weight: weights.dataVolume, contribution: dvC },
    { key: "fanOut", value: fanOut, kind: "additive", weight: weights.fanOut, contribution: foC },
    {
      key: "referenceCount",
      value: referenceCount,
      kind: "additive",
      weight: weights.referenceCount,
      contribution: rcC,
    },
    {
      key: "reversibility",
      value: reversibility,
      kind: "multiplier",
      weight: reversibilityFactor,
      contribution: reversibilityFactor,
    },
    { key: "envCriticality", value: envCriticality, kind: "multiplier", weight: envFactor, contribution: envFactor },
  ];

  return { score, level, policyVersion: policy.policyVersion, factors };
}

/**
 * Validates configured frequency rules before any scoring runs. Fails closed on
 * malformed rules (empty/blank action lists, non-positive windows, fractional
 * or sub-1 thresholds, negative or non-finite boosts) so a corrupt rule can
 * never silently disable or skew burst detection.
 */
function assertFrequencyRules(rules: EpisodeFrequencyRule[]): void {
  for (const rule of rules) {
    if (
      !Array.isArray(rule.actions) ||
      rule.actions.length === 0 ||
      rule.actions.some((action) => typeof action !== "string" || action.length === 0)
    ) {
      throw new TypeError("frequencyRules[].actions must be a non-empty array of non-empty strings");
    }
    if (typeof rule.windowSeconds !== "number" || !Number.isFinite(rule.windowSeconds) || rule.windowSeconds <= 0) {
      throw new TypeError("frequencyRules[].windowSeconds must be a finite number greater than 0");
    }
    if (typeof rule.threshold !== "number" || !Number.isInteger(rule.threshold) || rule.threshold < 1) {
      throw new TypeError("frequencyRules[].threshold must be an integer greater than or equal to 1");
    }
    if (typeof rule.boost !== "number" || !Number.isFinite(rule.boost) || rule.boost < 0) {
      throw new TypeError("frequencyRules[].boost must be a finite number greater than or equal to 0");
    }
  }
}

/**
 * Evaluates every configured frequency rule against the time-sorted steps using
 * an inclusive two-pointer sliding window (endMs - startMs <= windowSeconds *
 * 1000) over the steps whose action exact-matches the rule. Each rule fires at
 * most once per episode; frequencyScore is the clamped round4 sum of fired
 * boosts. Pure integer/compare math so TS/Python/Go agree byte-for-byte.
 */
function evaluateFrequencyRules(
  sorted: EpisodeRiskStep[],
  rules: EpisodeFrequencyRule[],
): { frequencyScore: number; frequencyMatches: FrequencyRuleMatch[] } {
  let boostSum = 0;
  const frequencyMatches = rules.map((rule) => {
    const timesMs: number[] = [];
    for (const step of sorted) {
      if (step.action !== undefined && rule.actions.includes(step.action)) {
        timesMs.push(Date.parse(step.occurredAt));
      }
    }
    let maxCount = 0;
    let start = 0;
    for (let end = 0; end < timesMs.length; end++) {
      const endMs = timesMs[end] as number;
      while (endMs - (timesMs[start] as number) > rule.windowSeconds * 1000) start++;
      const count = end - start + 1;
      if (count > maxCount) maxCount = count;
    }
    const fired = maxCount >= rule.threshold;
    if (fired) boostSum += rule.boost;
    return {
      actions: [...rule.actions],
      windowSeconds: rule.windowSeconds,
      threshold: rule.threshold,
      count: maxCount,
      fired,
      boost: fired ? rule.boost : 0,
    };
  });
  return { frequencyScore: clamp01(round4(boostSum)), frequencyMatches };
}

/**
 * Rolls a sequence of per-step scores into one episode score. Steps are sorted
 * by occurredAt ascending (non-mutating copy); momentum carries forward with
 * integer-window decay (decayPerWindow applied via repeated multiply, never
 * pow) so a burst of risky steps escalates while quiet gaps cool off.
 * Non-positive gaps clamp to zero windows (full carry). Returns peak (max raw
 * step score), velocityScore (normalized peak momentum), and the banded rollup.
 *
 * When the policy configures frequency rules, each rule is evaluated over the
 * sorted steps' optional `action` keys and the episode score becomes
 * clamp01(round4(max(peak, velocityScore, frequencyScore))). With no rules the
 * function takes literally the pre-frequency code path and emits no frequency
 * fields, keeping existing conformance fixtures and hash anchors byte-stable.
 */
export function rollupEpisodeRisk(
  steps: EpisodeRiskStep[],
  policy: RiskScoringPolicy = DEFAULT_RISK_POLICY,
): EpisodeRiskRollup {
  // Older hand-built policies may predate rollup.frequencyRules; absent means none.
  const frequencyRules = policy.rollup.frequencyRules ?? [];
  assertFrequencyRules(frequencyRules);

  if (steps.length === 0) {
    // bandOf(0) (not a hardcoded "none") keeps parity with Python/Go for
    // hand-built policies whose bands.low is <= 0.
    const empty: EpisodeRiskRollup = {
      score: 0,
      level: bandOf(0, policy.bands),
      peak: 0,
      velocityScore: 0,
      stepCount: 0,
      policyVersion: policy.policyVersion,
    };
    if (frequencyRules.length > 0) {
      const { frequencyScore, frequencyMatches } = evaluateFrequencyRules([], frequencyRules);
      empty.frequencyScore = frequencyScore;
      empty.frequencyMatches = frequencyMatches;
    }
    return empty;
  }

  const sorted = [...steps].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const { windowSeconds, decayPerWindow, velocityNormalizer } = policy.rollup;

  let peak = 0;
  let momentum = 0;
  let maxMomentum = 0;
  let previousMs: number | null = null;

  for (const step of sorted) {
    const currentMs = Date.parse(step.occurredAt);
    const carried =
      previousMs === null ? 0 : momentum * decayForGap(currentMs - previousMs, windowSeconds, decayPerWindow);
    momentum = round4(step.score + carried);
    if (momentum > maxMomentum) maxMomentum = momentum;
    if (step.score > peak) peak = step.score;
    previousMs = currentMs;
  }

  const velocityScore = clamp01(round4(maxMomentum / velocityNormalizer));
  if (frequencyRules.length > 0) {
    const { frequencyScore, frequencyMatches } = evaluateFrequencyRules(sorted, frequencyRules);
    const score = clamp01(round4(Math.max(peak, velocityScore, frequencyScore)));
    return {
      score,
      level: bandOf(score, policy.bands),
      peak,
      velocityScore,
      stepCount: sorted.length,
      policyVersion: policy.policyVersion,
      frequencyScore,
      frequencyMatches,
    };
  }
  const score = clamp01(round4(Math.max(peak, velocityScore)));
  return {
    score,
    level: bandOf(score, policy.bands),
    peak,
    velocityScore,
    stepCount: sorted.length,
    policyVersion: policy.policyVersion,
  };
}

/**
 * Computes the decay multiplier for a time gap: floor the (non-negative) gap
 * into whole windows, then apply decayPerWindow once per window by repeated
 * multiply. Avoids Math.pow so TS/Python/Go produce identical bytes.
 */
function decayForGap(deltaMs: number, windowSeconds: number, decayPerWindow: number): number {
  const deltaSeconds = Math.max(0, deltaMs / 1000);
  const windows = Math.floor(deltaSeconds / windowSeconds);
  let decay = 1;
  for (let i = 0; i < windows; i++) {
    decay = decay * decayPerWindow;
  }
  return decay;
}

/**
 * Stamps normalized risk signals onto caller metadata at metadata.riskSignals,
 * applied AFTER the caller's keys so a host can never shadow the scored envelope.
 * Normalizes (and therefore fail-closes on invalid signals) so the stored
 * riskSignals is always the fully-defaulted, byte-stable shape the scorer reads.
 * Non-mutating: returns a fresh metadata object.
 */
export function withRiskSignals(metadata: Record<string, unknown>, signals: RiskSignals): Record<string, unknown> {
  return { ...metadata, riskSignals: normalizeRiskSignals(signals) };
}

// Temperature-derived policies live in ./risk-policy (crypto-free, uses only
// this module's types + round4) and are re-exported here so the browser-safe
// `@veritio/core/risk-score` subpath exposes riskPolicy without extra imports.
// The import cycle is benign: risk-policy only references these bindings at
// call time, never during module evaluation.
export * from "./risk-policy.js";
