/**
 * Risk scoring math for the Veritio evidence layer. This module is language-
 * neutral protocol math: it must stay byte-identical across the TypeScript,
 * Python, and Go SDKs, so it uses ONLY clamp/floor/divide/multiply (never
 * pow/exp/log) and pins every constant in DEFAULT_RISK_POLICY. SDK core
 * (createAuditEvent) intentionally knows nothing about scoring.
 */

import { createHash, randomUUID } from "node:crypto";
import type { AuditEventInput, Principal } from "./index";
import { canonicalJson, hashIdempotencyKey } from "./index";
import type { EvidenceRef } from "./governed-change";
import { mergeVeritioMetadata } from "./governed-change";

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

/** Result of rolling many steps into one episode-level risk summary. */
export interface EpisodeRiskRollup {
  score: number;
  level: RiskLevel;
  peak: number;
  velocityScore: number;
  stepCount: number;
  policyVersion: string;
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
  rollup: { windowSeconds: number; decayPerWindow: number; velocityNormalizer: number };
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
  rollup: { windowSeconds: 60, decayPerWindow: 0.5, velocityNormalizer: 3.0 },
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
 * Rolls a sequence of per-step scores into one episode score. Steps are sorted
 * by occurredAt ascending (non-mutating copy); momentum carries forward with
 * integer-window decay (decayPerWindow applied via repeated multiply, never
 * pow) so a burst of risky steps escalates while quiet gaps cool off.
 * Non-positive gaps clamp to zero windows (full carry). Returns peak (max raw
 * step score), velocityScore (normalized peak momentum), and the banded rollup.
 */
export function rollupEpisodeRisk(
  steps: { occurredAt: string; score: number }[],
  policy: RiskScoringPolicy = DEFAULT_RISK_POLICY,
): EpisodeRiskRollup {
  if (steps.length === 0) {
    return {
      score: 0,
      level: "none",
      peak: 0,
      velocityScore: 0,
      stepCount: 0,
      policyVersion: policy.policyVersion,
    };
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

/**
 * Append-only `assertion.recorded` envelope for a security.risk conclusion. This
 * is the language-neutral record the Python and Go SDKs must reproduce byte for
 * byte: field names, the fixed `veritio`/`veritio.detectors` authorities, and the
 * conclusion/factors shape all feed the canonical hash, so nothing here may drift.
 */
export interface SecurityRiskAssertion {
  recordType: "assertion.recorded";
  schemaVersion: "2026-06-23";
  recordAuthority: "veritio";
  id: string;
  type: "security.risk";
  scope: { tenantId: string; workspaceId?: string; environment?: string };
  occurredAt: string;
  producer: { authority: "veritio.detectors"; kind: "principal"; type: "service"; id: string };
  idempotencyKeyHash: string;
  subject: EvidenceRef;
  conclusion: { score: number; level: RiskLevel; policyVersion: string; assessment: "step" | "episode_rollup" };
  factors: RiskFactor[];
}

/**
 * Input for {@link createSecurityRiskAssertion}. The caller supplies an already
 * computed conclusion (from scoreRiskSignals / rollupEpisodeRisk) and the evidence
 * subject the conclusion is about. This builder never recomputes a score: it only
 * stamps the deterministic, append-only envelope. The raw idempotency key is
 * tenant-scoped hashed and never stored.
 */
export interface SecurityRiskAssertionInput {
  id?: string;
  scope: { tenantId: string; workspaceId?: string; environment?: string };
  occurredAt?: string | Date;
  producerId: string;
  subject: EvidenceRef;
  idempotencyKey: string;
  conclusion: { score: number; level: RiskLevel; policyVersion: string; assessment: "step" | "episode_rollup" };
  factors: RiskFactor[];
}

const RISK_LEVELS = new Set<RiskLevel>(["none", "low", "medium", "high", "critical"]);

/**
 * Fail-closed guard on a caller-supplied risk conclusion before it is stamped
 * into an assertion record or event metadata. The builders never recompute a
 * score, so a corrupt score (NaN/Infinity/out-of-range) or an unknown level
 * would otherwise ride unchecked into the canonical hash and read models; this
 * keeps published conclusions inside the protocol's documented [0,1]/RiskLevel
 * bounds, parity with the magnitude/enum fail-closed checks elsewhere here.
 */
function assertRiskConclusion(conclusion: { score: number; level: RiskLevel }, field: string): void {
  if (
    typeof conclusion.score !== "number" ||
    !Number.isFinite(conclusion.score) ||
    conclusion.score < 0 ||
    conclusion.score > 1
  ) {
    throw new TypeError(`${field}.score must be a finite number in [0,1]`);
  }
  if (!RISK_LEVELS.has(conclusion.level)) {
    throw new TypeError(`${field}.level must be a known risk level`);
  }
}

const EVIDENCE_REF_KINDS = new Set<EvidenceRef["kind"]>([
  "principal",
  "entity",
  "activity",
  "change",
  "revision",
  "assertion",
  "record",
  "commit",
]);

/**
 * Requires a non-empty string for an assertion-builder field, failing closed so a
 * tenantless or producerless assertion can never enter the evidence graph.
 */
function assertRiskText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
}

/**
 * Validates a structured evidence reference (authority/kind/type/id) before it is
 * embedded as an assertion subject. Mirrors governed-change ref validation so the
 * same ref is portable across change, revision, and assertion records.
 */
function assertEvidenceRef(ref: EvidenceRef | undefined, field: string): asserts ref is EvidenceRef {
  assertRiskText(ref?.authority, `${field}.authority`);
  assertRiskText(ref?.type, `${field}.type`);
  assertRiskText(ref?.id, `${field}.id`);
  if (!EVIDENCE_REF_KINDS.has((ref as EvidenceRef).kind)) {
    throw new TypeError(`${field}.kind must be a supported evidence ref kind`);
  }
}

/**
 * Deterministic cross-language occurredAt normalization. Identical to the
 * governed-change normalizer (zone-less timestamps are treated as UTC) so the same
 * occurredAt produces the same canonical bytes in the TypeScript, Python, and Go
 * SDKs and the assertion hash stays stable.
 */
function normalizeRiskDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("occurredAt must be a valid date");
    }
    return value.toISOString();
  }
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("occurredAt must be a valid date");
  }
  return date.toISOString();
}

/**
 * Builds the language-neutral `assertion.recorded` envelope for a security.risk
 * conclusion. The producer authority is fixed to `veritio.detectors` so hosted
 * detectors cannot forge a different evidence authority, the idempotency key is
 * tenant-scoped hashed (never stored raw), and only the documented fields are
 * copied so unknown host fields cannot ride into the canonical hash.
 */
export function createSecurityRiskAssertion(input: SecurityRiskAssertionInput): SecurityRiskAssertion {
  assertRiskText(input.scope?.tenantId, "scope.tenantId");
  assertRiskText(input.producerId, "producerId");
  assertRiskText(input.idempotencyKey, "idempotencyKey");
  assertEvidenceRef(input.subject, "subject");
  assertRiskConclusion(input.conclusion, "conclusion");
  if (input.conclusion.assessment !== "step" && input.conclusion.assessment !== "episode_rollup") {
    throw new TypeError("conclusion.assessment must be 'step' or 'episode_rollup'");
  }

  const scope: SecurityRiskAssertion["scope"] = { tenantId: input.scope.tenantId };
  if (input.scope.workspaceId) {
    scope.workspaceId = input.scope.workspaceId;
  }
  if (input.scope.environment) {
    scope.environment = input.scope.environment;
  }

  return {
    recordType: "assertion.recorded",
    schemaVersion: "2026-06-23",
    recordAuthority: "veritio",
    id: input.id ?? `asr_${randomUUID()}`,
    type: "security.risk",
    scope,
    occurredAt: normalizeRiskDate(input.occurredAt ?? new Date()),
    producer: { authority: "veritio.detectors", kind: "principal", type: "service", id: input.producerId },
    idempotencyKeyHash: hashIdempotencyKey(input.scope.tenantId, input.idempotencyKey),
    subject: {
      authority: input.subject.authority,
      kind: input.subject.kind,
      type: input.subject.type,
      id: input.subject.id,
    },
    conclusion: {
      score: input.conclusion.score,
      level: input.conclusion.level,
      policyVersion: input.conclusion.policyVersion,
      assessment: input.conclusion.assessment,
    },
    factors: input.factors.map((factor) => ({
      key: factor.key,
      value: factor.value,
      kind: factor.kind,
      weight: factor.weight,
      contribution: factor.contribution,
    })),
  };
}

/**
 * Recomputes the canonical hash for a security.risk assertion record. Parity with
 * hashAuditRecord: bare lowercase SHA-256 hex over the canonical JSON of the
 * record's documented fields, excluding any stored `hash` field so a persisted
 * digest never feeds back into its own recomputation (matching Python's
 * key!='hash' filter and Go's documented-field rebuild). EvidenceCommit members
 * reference this digest as `sha256:<hex>`; the bare hex stays the cross-language
 * source of truth.
 */
export function hashAssertionRecord(assertion: SecurityRiskAssertion): string {
  const { hash: _ignored, ...rest } = assertion as SecurityRiskAssertion & { hash?: string };
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

/**
 * Input for {@link buildSecurityRiskAssessedEvent}. Carries the computed conclusion
 * plus optional normalized risk signals and the activity episode this assessment
 * belongs to. `metadata` is caller-owned; reserved context keys (activityEpisodeId)
 * are applied by the SDK and cannot be supplied here.
 */
export interface SecurityRiskAssessedEventInput {
  scope: { tenantId: string; workspaceId?: string; environment?: string };
  occurredAt?: string | Date;
  producerId: string;
  actor?: Principal;
  subject: EvidenceRef;
  conclusion: { score: number; level: RiskLevel; policyVersion: string; assessment: "step" | "episode_rollup" };
  factors?: RiskFactor[];
  riskSignals?: RiskSignals;
  activityEpisodeId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Builds the `security.risk.assessed` audit event input for a risk conclusion. The
 * subject becomes the event target, the producer becomes a service actor, the risk
 * conclusion (and optional normalized signals) ride in metadata, and the activity
 * episode id is stamped via mergeVeritioMetadata AFTER caller metadata so a caller
 * can never shadow the key Change/Trace/Explain read models group on. Returns an
 * AuditEventInput; the host recorder runs createAuditEvent (redaction + hashing).
 */
export function buildSecurityRiskAssessedEvent(input: SecurityRiskAssessedEventInput): AuditEventInput {
  assertRiskText(input.scope?.tenantId, "scope.tenantId");
  assertRiskText(input.producerId, "producerId");
  assertEvidenceRef(input.subject, "subject");
  assertRiskConclusion(input.conclusion, "conclusion");

  const baseMetadata: Record<string, unknown> = input.riskSignals
    ? withRiskSignals(input.metadata ?? {}, input.riskSignals)
    : { ...(input.metadata ?? {}) };

  baseMetadata.riskAssessment = {
    score: input.conclusion.score,
    level: input.conclusion.level,
    policyVersion: input.conclusion.policyVersion,
    assessment: input.conclusion.assessment,
    ...(input.factors ? { factors: input.factors } : {}),
  };

  // Build the reserved-context object conditionally: under exactOptionalPropertyTypes
  // an explicit `activityEpisodeId: undefined` is not assignable to VeritioContextMetadata,
  // and mergeVeritioMetadata already omits undefined context values at runtime.
  const metadata = mergeVeritioMetadata(
    baseMetadata,
    input.activityEpisodeId !== undefined ? { activityEpisodeId: input.activityEpisodeId } : {},
  );

  const event: AuditEventInput = {
    scope: input.scope,
    actor: input.actor ?? { type: "service", id: input.producerId },
    action: "security.risk.assessed",
    target: { type: input.subject.type, id: input.subject.id },
    metadata,
  };
  if (input.occurredAt !== undefined) {
    event.occurredAt = input.occurredAt;
  }
  return event;
}
