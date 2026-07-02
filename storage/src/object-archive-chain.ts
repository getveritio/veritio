import { createHash } from "node:crypto";
import { canonicalJson, type VerificationResult } from "@veritio/core";

/**
 * Minimal object-storage contract the archive needs from a host-injected
 * client (Cloudflare R2, AWS S3, MinIO, or any S3-compatible store). The host
 * owns credentials, bucket provisioning, retries, and pagination: `list` must
 * return every key under `prefix`. Bodies are opaque bytes so the archived
 * canonical JSON is never re-encoded by a driver.
 */
export interface ObjectArchiveClient {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<readonly string[]>;
}

/**
 * Commit point for one sealed segment. The manifest is written AFTER the
 * segment object, so a manifest's existence guarantees its segment bytes are
 * durable; readers treat the manifest as the authority for range, linkage,
 * and the segment content digest.
 */
export interface ObjectArchiveSegmentManifest {
  tenantId: string;
  fromSequence: number;
  toSequence: number;
  recordCount: number;
  firstPreviousHash: string | null;
  lastHash: string;
  segmentKey: string;
  contentSha256: string;
  sealedAt: string;
}

/** Full-archive replay outcome for one chain (events or edges) of one tenant. */
export interface ObjectArchiveChainVerification {
  ok: boolean;
  segmentCount: number;
  recordCount: number;
  /** Core chain verification when all segments were readable, else null. */
  verification: VerificationResult | null;
  /** Sanitized failure summary when ok is false. */
  reason?: string;
}

/** Envelope fields every archivable chain record shares (audit and edge records). */
export interface ChainEnvelopeRecord {
  sequence: number;
  previousHash: string | null;
  hash: string;
}

/**
 * Per-chain behavior injected by the public archive: which key namespace the
 * chain lives under, how to read a record's tenant scope, how to recompute
 * its envelope hash, and which core verifier replays the whole chain. Keeps
 * hashing/verification in `@veritio/core` — never reimplemented here.
 */
export interface ChainSegmentCodec<R extends ChainEnvelopeRecord> {
  chainSegment: "events" | "edges";
  tenantOf(record: R): string | undefined;
  rehash(record: R): string;
  verifyChain(records: readonly R[]): VerificationResult;
}

/** Seal/list/read/verify surface for one chain kind, composed by the public archive. */
export interface ChainSegmentArchive<R extends ChainEnvelopeRecord> {
  seal(records: readonly R[]): Promise<ObjectArchiveSegmentManifest>;
  list(tenantId: string): Promise<ObjectArchiveSegmentManifest[]>;
  read(manifest: ObjectArchiveSegmentManifest): Promise<R[]>;
  verify(tenantId: string): Promise<ObjectArchiveChainVerification>;
}

const MANIFEST_SUFFIX = ".manifest.json";
const SEQUENCE_PAD = 16;
const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Generic sealed-segment machinery for one hash-linked chain on object
 * storage. Fail-closed everywhere: sealing validates hashes, tenant scope,
 * and chain continuity before any byte is written; reads recompute the
 * segment digest and every record hash before returning records. Segments
 * hold the exact `canonicalJson` bytes of each record as NDJSON lines so the
 * chain verifies byte-for-byte from the archive alone.
 */
export function createChainSegmentArchive<R extends ChainEnvelopeRecord>(
  client: ObjectArchiveClient,
  prefix: string,
  codec: ChainSegmentCodec<R>,
): ChainSegmentArchive<R> {
  /** Key namespace for one tenant's segments of this chain kind. */
  const tenantPrefix = (tenantId: string): string => `${prefix}/${encodeURIComponent(tenantId)}/${codec.chainSegment}/`;

  /** Reads and shape-validates every manifest for a tenant, sorted by range. */
  async function listManifests(tenantId: string): Promise<ObjectArchiveSegmentManifest[]> {
    const keys = await client.list(tenantPrefix(tenantId));
    const manifestKeys = [...keys].filter((key) => key.endsWith(MANIFEST_SUFFIX)).sort();
    const manifests: ObjectArchiveSegmentManifest[] = [];
    for (const key of manifestKeys) {
      const body = await client.get(key);
      if (body === null) {
        throw new TypeError("archived segment manifest is missing");
      }
      manifests.push(parseManifest(new TextDecoder().decode(body)));
    }
    manifests.sort((a, b) => a.fromSequence - b.fromSequence);
    return manifests;
  }

  /** Parses one archived NDJSON line, failing closed unless it is the exact canonical bytes of a hash-valid record. */
  function parseArchivedRecord(line: string, tenantId: string): R {
    let record: R;
    try {
      record = JSON.parse(line) as R;
    } catch {
      throw new TypeError("archived record integrity check failed");
    }
    if (codec.tenantOf(record) !== tenantId || canonicalJson(record) !== line || codec.rehash(record) !== record.hash) {
      throw new TypeError("archived record integrity check failed");
    }
    return record;
  }

  return {
    async seal(records) {
      if (records.length === 0) {
        throw new TypeError("segment requires at least one record");
      }
      const tenantId = validateSegmentRecords(records, codec);
      const first = records[0]!;
      const last = records[records.length - 1]!;
      const body = new TextEncoder().encode(`${records.map((record) => canonicalJson(record)).join("\n")}\n`);
      const contentSha256 = sha256Hex(body);

      const manifests = await listManifests(tenantId);
      const tip = manifests[manifests.length - 1];
      if (tip && first.sequence <= tip.toSequence) {
        // Idempotent replay: re-sealing an identical, already-sealed range
        // returns the original manifest; any other overlap is a conflict.
        const existing = manifests.find(
          (manifest) => manifest.fromSequence === first.sequence && manifest.toSequence === last.sequence,
        );
        if (existing && existing.contentSha256 === contentSha256) {
          return existing;
        }
        throw new TypeError("segment conflict");
      }
      if (!tip && (first.sequence !== 1 || first.previousHash !== null)) {
        throw new TypeError("archive must start at the tenant chain origin");
      }
      if (tip && (first.sequence !== tip.toSequence + 1 || first.previousHash !== tip.lastHash)) {
        throw new TypeError("segment does not extend the archived tenant chain");
      }

      const rangeName = `${padSequence(first.sequence)}-${padSequence(last.sequence)}`;
      const segmentKey = `${tenantPrefix(tenantId)}${rangeName}.ndjson`;
      const manifest: ObjectArchiveSegmentManifest = {
        tenantId,
        fromSequence: first.sequence,
        toSequence: last.sequence,
        recordCount: records.length,
        firstPreviousHash: first.previousHash,
        lastHash: last.hash,
        segmentKey,
        contentSha256,
        sealedAt: new Date().toISOString(),
      };
      // Segment first, manifest last: the manifest is the commit point, so a
      // crash between the two writes leaves an unreferenced segment object,
      // never a manifest pointing at missing or partial bytes.
      await client.put(segmentKey, body);
      await client.put(`${segmentKey}${MANIFEST_SUFFIX}`, new TextEncoder().encode(canonicalJson(manifest)));
      return manifest;
    },

    list(tenantId) {
      requireNonEmpty(tenantId, "tenantId");
      return listManifests(tenantId);
    },

    async read(manifest) {
      const body = await client.get(manifest.segmentKey);
      if (body === null) {
        throw new TypeError("archived segment is missing");
      }
      if (sha256Hex(body) !== manifest.contentSha256) {
        throw new TypeError("archived segment integrity check failed");
      }
      const lines = new TextDecoder()
        .decode(body)
        .split("\n")
        .filter((line) => line.length > 0);
      if (lines.length !== manifest.recordCount) {
        throw new TypeError("archived segment integrity check failed");
      }
      const records = lines.map((line) => parseArchivedRecord(line, manifest.tenantId));
      const first = records[0]!;
      const last = records[records.length - 1]!;
      if (
        first.sequence !== manifest.fromSequence ||
        last.sequence !== manifest.toSequence ||
        first.previousHash !== manifest.firstPreviousHash ||
        last.hash !== manifest.lastHash
      ) {
        throw new TypeError("archived segment integrity check failed");
      }
      return records;
    },

    async verify(tenantId) {
      requireNonEmpty(tenantId, "tenantId");
      const manifests = await listManifests(tenantId);
      if (manifests.length === 0) {
        return { ok: true, segmentCount: 0, recordCount: 0, verification: null };
      }
      const failure = (recordCount: number, reason: string): ObjectArchiveChainVerification => ({
        ok: false,
        segmentCount: manifests.length,
        recordCount,
        verification: null,
        reason,
      });
      if (manifests[0]!.fromSequence !== 1) {
        return failure(0, "archive does not start at the tenant chain origin");
      }
      const records: R[] = [];
      let previous: ObjectArchiveSegmentManifest | undefined;
      for (const manifest of manifests) {
        if (
          previous &&
          (manifest.fromSequence !== previous.toSequence + 1 || manifest.firstPreviousHash !== previous.lastHash)
        ) {
          return failure(records.length, "archived segments are not contiguous");
        }
        try {
          records.push(...(await this.read(manifest)));
        } catch (error) {
          if (error instanceof TypeError) {
            return failure(records.length, error.message);
          }
          throw error;
        }
        previous = manifest;
      }
      const verification = codec.verifyChain(records);
      const result: ObjectArchiveChainVerification = {
        ok: verification.ok,
        segmentCount: manifests.length,
        recordCount: records.length,
        verification,
      };
      if (!verification.ok) {
        result.reason = "archived chain verification failed";
      }
      return result;
    },
  };
}

/**
 * Validates a candidate segment before anything is written: single tenant,
 * strictly contiguous sequences, intra-segment previous-hash linkage, and a
 * byte-exact hash recompute per record. Returns the segment's tenant id.
 */
function validateSegmentRecords<R extends ChainEnvelopeRecord>(
  records: readonly R[],
  codec: ChainSegmentCodec<R>,
): string {
  const tenantId = codec.tenantOf(records[0]!);
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new TypeError("scope.tenantId is required");
  }
  let previous: R | undefined;
  for (const record of records) {
    if (codec.tenantOf(record) !== tenantId) {
      throw new TypeError("segment must contain a single tenant chain");
    }
    if (codec.rehash(record) !== record.hash) {
      throw new TypeError("record integrity check failed");
    }
    if (previous && (record.sequence !== previous.sequence + 1 || record.previousHash !== previous.hash)) {
      throw new TypeError("segment records must be contiguous and hash-linked");
    }
    previous = record;
  }
  return tenantId;
}

/** Shape-validates a stored manifest so corrupted metadata fails closed instead of steering reads. */
function parseManifest(text: string): ObjectArchiveSegmentManifest {
  let parsed: Partial<ObjectArchiveSegmentManifest>;
  try {
    parsed = JSON.parse(text) as Partial<ObjectArchiveSegmentManifest>;
  } catch {
    throw new TypeError("archived segment manifest integrity check failed");
  }
  const valid =
    typeof parsed.tenantId === "string" &&
    parsed.tenantId.trim().length > 0 &&
    Number.isInteger(parsed.fromSequence) &&
    (parsed.fromSequence as number) >= 1 &&
    Number.isInteger(parsed.toSequence) &&
    (parsed.toSequence as number) >= (parsed.fromSequence as number) &&
    Number.isInteger(parsed.recordCount) &&
    parsed.recordCount === (parsed.toSequence as number) - (parsed.fromSequence as number) + 1 &&
    (parsed.firstPreviousHash === null || SHA256_HEX.test(parsed.firstPreviousHash ?? "")) &&
    SHA256_HEX.test(parsed.lastHash ?? "") &&
    SHA256_HEX.test(parsed.contentSha256 ?? "") &&
    typeof parsed.segmentKey === "string" &&
    typeof parsed.sealedAt === "string";
  if (!valid) {
    throw new TypeError("archived segment manifest integrity check failed");
  }
  return parsed as ObjectArchiveSegmentManifest;
}

/** Left-pads a sequence so lexicographic key order equals numeric chain order. */
function padSequence(sequence: number): string {
  return String(sequence).padStart(SEQUENCE_PAD, "0");
}

/** Rejects blank required string arguments with the argument name only (no values) in the error. */
export function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} is required`);
  }
}

/** Hex sha256 of raw segment bytes for the manifest content digest. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
