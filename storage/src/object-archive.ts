import {
  type AuditRecord,
  type AuditStore,
  type EvidenceEdgeRecord,
  hashAuditRecord,
  hashEvidenceEdgeRecord,
  verifyAuditRecords,
  verifyEvidenceEdgeRecords,
} from "@veritio/core";
import {
  type ChainSegmentArchive,
  createChainSegmentArchive,
  type ObjectArchiveChainVerification,
  type ObjectArchiveClient,
  type ObjectArchiveSegmentManifest,
  requireNonEmpty,
} from "./object-archive-chain.js";

export type {
  ObjectArchiveChainVerification,
  ObjectArchiveClient,
  ObjectArchiveSegmentManifest,
} from "./object-archive-chain.js";

export interface ObjectAuditArchiveOptions {
  client: ObjectArchiveClient;
  /** Key prefix isolating this archive inside a shared bucket. */
  prefix?: string;
}

/** Combined event-chain + edge-chain replay outcome, mirroring `FileEvidenceVerification`. */
export interface ObjectArchiveVerification {
  ok: boolean;
  audit: ObjectArchiveChainVerification;
  edges: ObjectArchiveChainVerification;
}

/**
 * Derived cold tier for a tenant's evidence chains on object storage. This is
 * NOT an `AuditStore` and must never own appends: object storage cannot
 * couple gapless per-tenant sequencing to idempotency-conflict checks
 * atomically, so sequencing stays in a conforming authoritative store and
 * this tier archives already-sequenced records. Events and edges are the
 * protocol's two independently sequenced chains, so they archive under
 * separate key namespaces and `verifyTenant` replays both, mirroring
 * `FileEvidenceStore.verify`.
 *
 * Concurrency contract: one archiver per tenant. Sealing is idempotent for a
 * byte-identical replay of an already-sealed range and fails closed on any
 * overlap or gap, but two concurrent sealers can still race the tip check;
 * hosts must serialize archiving per tenant.
 */
export interface ObjectAuditArchive {
  sealSegment(records: readonly AuditRecord[]): Promise<ObjectArchiveSegmentManifest>;
  sealEdgeSegment(records: readonly EvidenceEdgeRecord[]): Promise<ObjectArchiveSegmentManifest>;
  listSegments(tenantId: string): Promise<ObjectArchiveSegmentManifest[]>;
  listEdgeSegments(tenantId: string): Promise<ObjectArchiveSegmentManifest[]>;
  readSegment(manifest: ObjectArchiveSegmentManifest): Promise<AuditRecord[]>;
  readEdgeSegment(manifest: ObjectArchiveSegmentManifest): Promise<EvidenceEdgeRecord[]>;
  verifyTenant(tenantId: string): Promise<ObjectArchiveVerification>;
}

const DEFAULT_ARCHIVE_PREFIX = "veritio-archive";

/**
 * Creates the object-storage archive over an injected S3/R2-compatible
 * client. Composes one chain archive per protocol chain (events, edges); all
 * hashing and chain verification come from `@veritio/core` codecs so this
 * layer never reimplements protocol semantics.
 */
export function createObjectAuditArchive(options: ObjectAuditArchiveOptions): ObjectAuditArchive {
  const prefix = options.prefix ?? DEFAULT_ARCHIVE_PREFIX;
  const events: ChainSegmentArchive<AuditRecord> = createChainSegmentArchive<AuditRecord>(options.client, prefix, {
    chainSegment: "events",
    tenantOf: (record) => record.event.scope?.tenantId,
    rehash: hashAuditRecord,
    verifyChain: verifyAuditRecords,
  });
  const edges: ChainSegmentArchive<EvidenceEdgeRecord> = createChainSegmentArchive<EvidenceEdgeRecord>(
    options.client,
    prefix,
    {
      chainSegment: "edges",
      tenantOf: (record) => record.edge.scope?.tenantId,
      rehash: hashEvidenceEdgeRecord,
      verifyChain: verifyEvidenceEdgeRecords,
    },
  );

  return {
    sealSegment: (records) => events.seal(records),
    sealEdgeSegment: (records) => edges.seal(records),
    listSegments: (tenantId) => events.list(tenantId),
    listEdgeSegments: (tenantId) => edges.list(tenantId),
    readSegment: (manifest) => events.read(manifest),
    readEdgeSegment: (manifest) => edges.read(manifest),

    async verifyTenant(tenantId) {
      const audit = await events.verify(tenantId);
      const edgeChain = await edges.verify(tenantId);
      return { ok: audit.ok && edgeChain.ok, audit, edges: edgeChain };
    },
  };
}

/**
 * Drains a tenant's un-archived event tail from a conforming authoritative
 * `AuditStore` into sealed archive segments. Resumes from the archive's own
 * tip, so repeated runs are incremental and a re-run after a partial failure
 * is an idempotent replay. Covers the event chain only — `AuditStore` does
 * not expose edge records; hosts seal edge batches via `sealEdgeSegment`.
 * Callers serialize invocations per tenant.
 */
export async function archiveAuditStoreTenant(options: {
  archive: ObjectAuditArchive;
  store: AuditStore;
  tenantId: string;
  segmentRecordCount?: number;
}): Promise<ObjectArchiveSegmentManifest[]> {
  const segmentRecordCount = options.segmentRecordCount ?? 1000;
  if (!Number.isInteger(segmentRecordCount) || segmentRecordCount < 1) {
    throw new TypeError("segmentRecordCount must be a positive integer");
  }
  requireNonEmpty(options.tenantId, "tenantId");
  const manifests = await options.archive.listSegments(options.tenantId);
  let afterSequence = manifests[manifests.length - 1]?.toSequence ?? 0;
  const sealed: ObjectArchiveSegmentManifest[] = [];
  for (;;) {
    const batch = await options.store.list(
      { tenantId: options.tenantId },
      { afterSequence, limit: segmentRecordCount },
    );
    if (batch.length === 0) {
      break;
    }
    sealed.push(await options.archive.sealSegment(batch));
    afterSequence = batch[batch.length - 1]!.sequence;
    if (batch.length < segmentRecordCount) {
      break;
    }
  }
  return sealed;
}
