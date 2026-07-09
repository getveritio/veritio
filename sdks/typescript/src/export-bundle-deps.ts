/**
 * Stable local aliases for the SDK primitives the export-bundle module consumes.
 *
 * The export-bundle code (and its later build/verify tasks) imports ONLY from
 * this shim so the primitive surface it depends on is pinned in one place. If a
 * core SDK export is renamed, this file is the single point that must change;
 * downstream export-bundle code stays untouched. This shim never alters record
 * schemas, hashing semantics, or canonicalization — it only re-exports or
 * shape-adapts existing behavior.
 */

import {
  type AuditRecord,
  canonicalJson as canonicalJsonImpl,
  type EvidenceCommit,
  type EvidenceEdgeRecord,
  verifyAuditRecords,
  verifyEvidenceCommits,
  verifyEvidenceEdgeRecords,
} from "./index.js";

/**
 * Protocol canonical JSON: key-sorted, undefined object fields omitted, array
 * holes nulled. Re-exported verbatim from the SDK core so export-bundle hashing
 * and fixtures use the exact same bytes the rest of the protocol uses.
 */
export const canonicalJson: (value: unknown) => string = canonicalJsonImpl;

/**
 * Lowercase-hex SHA-256 of a UTF-8 string.
 *
 * The SDK core keeps its sha256 helper private (node:crypto), so this shim
 * provides the primitive directly via WebCrypto (`crypto.subtle.digest`) to
 * stay runtime-portable and avoid widening the core's public surface. The
 * digest bytes are identical to a node `createHash("sha256")` digest, so
 * hashes produced here match SDK core hashes over the same input. Async because
 * WebCrypto's digest API is Promise-based.
 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Normalized verifier result the export-bundle surface consumes. `valid`
 * collapses the core's `{ ok }` discriminated result; `issues` carries the
 * concrete failure detail (index + reason) when the chain is invalid.
 */
export interface ChainVerificationResult {
  valid: boolean;
  issues?: unknown[];
}

/**
 * Verifies an audit-record hash chain. Adapts the core `verifyAuditRecords`
 * result (`{ ok } | { ok:false, index, reason }`) into the shim's stable
 * `{ valid, issues? }` shape. Input is typed `unknown[]` because callers pass
 * records parsed from an untrusted bundle; verification re-hashes them.
 */
export function verifyAuditChain(records: unknown[]): ChainVerificationResult {
  return runChainVerifier(() => verifyAuditRecords(records as readonly AuditRecord[]));
}

/**
 * Verifies an evidence-edge hash chain. Same core-to-shim result adaptation as
 * {@link verifyAuditChain}, over `verifyEvidenceEdgeRecords`.
 */
export function verifyEdgeChain(records: unknown[]): ChainVerificationResult {
  return runChainVerifier(() => verifyEvidenceEdgeRecords(records as readonly EvidenceEdgeRecord[]));
}

/**
 * Verifies an evidence-commit chain. Same core-to-shim result adaptation as
 * {@link verifyAuditChain}, over `verifyEvidenceCommits`.
 */
export function verifyCommitChain(records: unknown[]): ChainVerificationResult {
  return runChainVerifier(() => verifyEvidenceCommits(records as readonly EvidenceCommit[]));
}

/**
 * Runs a core verifier and normalizes it to the shim's `{ valid, issues? }`
 * shape, failing closed if the verifier throws. Callers pass records parsed from
 * an untrusted bundle, and the core verifiers guard some — but not all —
 * structurally malformed records (a record missing its `event`/`edge`/commit
 * envelope throws rather than returning a verdict). Treating any throw as an
 * invalid chain keeps this shim's untrusted-input contract intact without
 * leaking raw error text into the issue payload.
 */
function runChainVerifier(run: () => { ok: boolean }): ChainVerificationResult {
  try {
    return toChainResult(run());
  } catch {
    return { valid: false, issues: [{ reason: "verifier_threw" }] };
  }
}

/**
 * Collapses a core `{ ok } | { ok:false, ... }` verification result into the
 * shim's `{ valid, issues? }` shape, preserving the failure detail as the sole
 * issue when the chain does not verify.
 */
function toChainResult(result: { ok: boolean }): ChainVerificationResult {
  return result.ok ? { valid: true } : { valid: false, issues: [result] };
}
