import type { AuditRecord, EvidenceEdgeRecord } from "./index.js";
import { HASH_ALGORITHM, hashAuditRecord, hashEvidenceEdgeRecord } from "./index.js";
import { verifyAuditChain, verifyEdgeChain, type ChainVerificationResult } from "./export-bundle-deps.js";

/**
 * Chain-verification scope of a vevb-1 bundle, declared in
 * `manifest.chainScope` (absent = `full`). The scope states which chain claim
 * the bundle makes, and the verifier holds it to exactly that claim:
 *
 * - `full` — the strict claim: every per-tenant chain starts at sequence 1
 *   with a null previousHash and is gapless. This is the only scope in which
 *   "no record was removed" is proven.
 * - `windowed` — a contiguous time-window export: each tenant's first record
 *   may enter mid-chain (any sequence, any well-formed previousHash), but every
 *   subsequent record must link strictly (sequence + 1, previousHash = prior
 *   hash). Interior removal is still detectable; leading/trailing truncation is
 *   declared, not hidden.
 * - `filtered` — a content-filtered export (see `manifest.filters`): interior
 *   gaps are inherent, so the verifier proves per-record integrity (every
 *   envelope hash recomputes) and per-tenant strictly-increasing sequences,
 *   and still enforces strict linkage wherever two records are sequence-
 *   adjacent. A filtered bundle deliberately claims less than a full one — the
 *   declaration in the manifest is what keeps that honest.
 */
export type ExportBundleChainScope = "full" | "windowed" | "filtered";

type EnvelopeAccessor<R> = {
  tenantId(record: R): string | undefined;
  hashAlgorithm(record: R): unknown;
  canonicalization(record: R): unknown;
  hash(record: R): unknown;
  previousHash(record: R): unknown;
  sequence(record: R): unknown;
  recomputeHash(record: R): string;
};

/**
 * Walks one record family's envelopes under a windowed or filtered scope.
 * Shared by the audit and edge walkers so the two families cannot drift: the
 * per-record checks (tenant scope present, declared algorithm and
 * canonicalization, envelope hash recomputes byte-for-byte) always run; the
 * linkage rules vary only in what a non-adjacent successor is allowed to be.
 */
function verifyScopedChain<R>(
  records: readonly R[],
  scope: Extract<ExportBundleChainScope, "windowed" | "filtered">,
  envelope: EnvelopeAccessor<R>,
): ChainVerificationResult {
  const tenantState = new Map<string, { previousHash: string; sequence: number }>();

  for (const record of records) {
    const tenantId = envelope.tenantId(record);
    if (!tenantId) return { valid: false, issues: ["missing_tenant_scope"] };
    if (envelope.hashAlgorithm(record) !== HASH_ALGORITHM) {
      return { valid: false, issues: ["unsupported_hash_algorithm"] };
    }
    if (envelope.canonicalization(record) !== "veritio-json-v1") {
      return { valid: false, issues: ["unsupported_canonicalization"] };
    }

    const sequence = envelope.sequence(record);
    const previousHash = envelope.previousHash(record);
    const hash = envelope.hash(record);
    if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
      return { valid: false, issues: ["sequence_mismatch"] };
    }
    if (typeof hash !== "string" || envelope.recomputeHash(record) !== hash) {
      return { valid: false, issues: ["hash_mismatch"] };
    }

    const state = tenantState.get(tenantId);
    if (state === undefined) {
      // First record seen for this tenant. Mid-chain entry is the point of a
      // scoped bundle — but a record claiming to be the chain start (sequence
      // 1) must still carry the null previousHash the full rule demands.
      if (sequence === 1 && previousHash !== null) {
        return { valid: false, issues: ["previous_hash_mismatch"] };
      }
      if (sequence > 1 && typeof previousHash !== "string") {
        return { valid: false, issues: ["previous_hash_mismatch"] };
      }
    } else if (sequence === state.sequence + 1) {
      // Sequence-adjacent records must link strictly in every scope.
      if (previousHash !== state.previousHash) {
        return { valid: false, issues: ["previous_hash_mismatch"] };
      }
    } else if (scope === "windowed") {
      // A window is contiguous by definition: any interior gap or reordering
      // is a removal, not a filter.
      return { valid: false, issues: ["sequence_mismatch"] };
    } else {
      // Filtered scope: gaps are inherent, but sequences must strictly
      // increase and the record across a gap still needs a well-formed link.
      if (sequence <= state.sequence) {
        return { valid: false, issues: ["sequence_mismatch"] };
      }
      if (typeof previousHash !== "string") {
        return { valid: false, issues: ["previous_hash_mismatch"] };
      }
    }

    tenantState.set(tenantId, { previousHash: hash, sequence });
  }

  return { valid: true };
}

const auditEnvelope: EnvelopeAccessor<AuditRecord> = {
  tenantId: (record) => record.event?.scope?.tenantId,
  hashAlgorithm: (record) => record.hashAlgorithm,
  canonicalization: (record) => record.canonicalization,
  hash: (record) => record.hash,
  previousHash: (record) => record.previousHash,
  sequence: (record) => record.sequence,
  recomputeHash: (record) => hashAuditRecord(record),
};

const edgeEnvelope: EnvelopeAccessor<EvidenceEdgeRecord> = {
  tenantId: (record) => record.edge?.scope?.tenantId,
  hashAlgorithm: (record) => record.hashAlgorithm,
  canonicalization: (record) => record.canonicalization,
  hash: (record) => record.hash,
  previousHash: (record) => record.previousHash,
  sequence: (record) => record.sequence,
  recomputeHash: (record) => hashEvidenceEdgeRecord(record),
};

/**
 * Verifies an audit-event chain under the given scope. `full` delegates to the
 * strict verifier; scoped bundles run the windowed/filtered walker. Records are
 * untrusted bundle content, so any throw (malformed envelope) fails closed.
 */
export function verifyAuditChainScoped(records: unknown[], scope: ExportBundleChainScope): ChainVerificationResult {
  if (scope === "full") return verifyAuditChain(records);
  try {
    return verifyScopedChain(records as readonly AuditRecord[], scope, auditEnvelope);
  } catch {
    return { valid: false, issues: ["malformed_record"] };
  }
}

/**
 * Verifies an evidence-edge chain under the given scope; see
 * {@link verifyAuditChainScoped}.
 */
export function verifyEdgeChainScoped(records: unknown[], scope: ExportBundleChainScope): ChainVerificationResult {
  if (scope === "full") return verifyEdgeChain(records);
  try {
    return verifyScopedChain(records as readonly EvidenceEdgeRecord[], scope, edgeEnvelope);
  } catch {
    return { valid: false, issues: ["malformed_record"] };
  }
}
