import {
  type AuditRecord,
  createAuditRecorder,
  createEvidenceCommit,
  type EvidenceCommit,
  type EvidenceCommitVerificationResult,
  MemoryAuditStore,
  type VerificationResult,
  verifyAuditRecords,
  verifyEvidenceCommits,
} from "@veritio/core";

/** Tenant used by every record in this scenario; verification is tenant-chained. */
export const TENANT_ID = "org_verify_demo";

const SCOPE = { tenantId: TENANT_ID, environment: "production" } as const;

/**
 * Records a small governed lifecycle into an in-memory AuditStore and returns
 * the persisted hash-chained records. The store assigns per-tenant sequence
 * numbers and links each record to the previous record's hash, so the returned
 * array is the exact artifact an auditor would replay through
 * `verifyAuditRecords`.
 */
export async function recordLifecycle(): Promise<AuditRecord[]> {
  const store = new MemoryAuditStore();
  const recorder = createAuditRecorder({ store });

  await recorder.record({
    actor: { type: "user", id: "usr_owner" },
    action: "org.member.invited",
    target: { type: "organization", id: "org_verify_demo" },
    scope: SCOPE,
    metadata: { role: "viewer" },
  });
  await recorder.record({
    actor: { type: "user", id: "usr_member" },
    action: "auth.session.created",
    target: { type: "session", id: "sess_01" },
    scope: SCOPE,
    metadata: { method: "passkey" },
  });
  await recorder.record({
    actor: { type: "user", id: "usr_member" },
    action: "entry.updated",
    target: { type: "entry", id: "ent_01" },
    scope: SCOPE,
    metadata: { fields: ["title"] },
  });

  return store.list({ tenantId: TENANT_ID });
}

/**
 * Verifies an untampered export. This is the happy path an auditor runs against
 * records fetched from any conforming AuditStore.
 */
export function verifyClean(records: AuditRecord[]): VerificationResult {
  return verifyAuditRecords(records);
}

/**
 * Simulates post-export payload tampering: someone edits stored metadata
 * without being able to recompute the chain. The record's stored hash no longer
 * matches its canonical bytes, so verification fails closed at that index with
 * `hash_mismatch`.
 */
export function tamperMetadata(records: AuditRecord[], index: number): VerificationResult {
  const tampered = records.map((record, at) =>
    at === index
      ? { ...record, event: { ...record.event, metadata: { ...record.event.metadata, role: "admin" } } }
      : record,
  );
  return verifyAuditRecords(tampered);
}

/**
 * Simulates evidence suppression: a record is deleted from the middle of the
 * export. The next record still points at the missing record's hash and
 * sequence, so verification fails closed with `sequence_mismatch` — a gapless
 * per-tenant chain cannot lose a link silently.
 */
export function dropRecord(records: AuditRecord[], index: number): VerificationResult {
  return verifyAuditRecords(records.filter((_, at) => at !== index));
}

/**
 * Simulates history rewriting: two records are swapped. Order is part of the
 * chain (sequence + previousHash), so reordering is detected even though every
 * individual record hash is still internally consistent.
 */
export function reorderRecords(records: AuditRecord[]): VerificationResult {
  const reordered = [...records];
  const second = reordered[1];
  const third = reordered[2];
  if (second === undefined || third === undefined) {
    throw new Error("scenario requires at least three records");
  }
  reordered[1] = third;
  reordered[2] = second;
  return verifyAuditRecords(reordered);
}

/**
 * Binds already-persisted records into an EvidenceCommit envelope: an ordered
 * Merkle manifest over the record hashes, itself hash-chained per stream. This
 * is the export-format layer — a bundle can prove both each record chain and
 * that the bundle's membership was not edited after commit.
 */
export function commitRecords(records: AuditRecord[]): EvidenceCommit {
  return createEvidenceCommit({
    commitId: "cmt_verify_demo_01",
    streamId: `str_${TENANT_ID}`,
    sequence: 1,
    previousCommitHash: null,
    members: records.map((record, index) => ({
      index,
      recordType: "audit.record",
      recordId: record.event.id,
      recordHash: `sha256:${record.hash}`,
    })),
  });
}

/**
 * Simulates manifest tampering: a member's record hash is swapped inside an
 * otherwise well-formed commit. The Merkle root no longer matches, so commit
 * verification fails closed with `records_root_mismatch`.
 */
export function tamperCommitManifest(commit: EvidenceCommit): EvidenceCommitVerificationResult {
  const [first, ...rest] = commit.members;
  if (first === undefined) {
    throw new Error("commit has no members");
  }
  const tampered: EvidenceCommit = {
    ...commit,
    members: [{ ...first, recordHash: `sha256:${"0".repeat(64)}` }, ...rest],
  };
  return verifyEvidenceCommits([tampered]);
}
