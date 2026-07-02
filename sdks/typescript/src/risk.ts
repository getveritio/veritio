/**
 * Security-risk ASSERTION builders for the Veritio evidence layer. The pure,
 * crypto-free scoring math (types, DEFAULT_RISK_POLICY, normalizeRiskSignals,
 * scoreRiskSignals, rollupEpisodeRisk, withRiskSignals) lives in `./risk-score`
 * and is re-exported here, so the public `@veritio/core` surface is unchanged.
 *
 * This module adds the parts that MUST run server/edge-side: the append-only
 * `security.risk` assertion record, its canonical hash, and the
 * `security.risk.assessed` event builder. They depend on `node:crypto` and the
 * canonical-JSON / reserved-context helpers, so they intentionally stay OUT of
 * the browser-safe `./risk-score` entry point.
 */

import { createHash, randomUUID } from "node:crypto";
import type { EvidenceRef } from "./governed-change.js";
import { mergeVeritioMetadata } from "./governed-change.js";
import type { AuditEventInput, Principal } from "./index.js";
import { canonicalJson, hashIdempotencyKey } from "./index.js";
import type { RiskFactor, RiskLevel, RiskSignals } from "./risk-score.js";
import { withRiskSignals } from "./risk-score.js";

export * from "./risk-score.js";

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
