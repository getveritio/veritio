import { describe, expect, test } from "bun:test";
import {
  canonicalJson,
  createAuditEvent,
  createEvidenceEdge,
  type EvidenceEdgeRecord,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  MemoryAuditStore,
} from "@veritio/core";
import { S3Client } from "bun";
import { archiveAuditStoreTenant, createObjectAuditArchive, type ObjectArchiveClient } from "../src/object-archive";

const endpoint = process.env.VERITIO_S3_TEST_ENDPOINT;
const accessKeyId = process.env.VERITIO_S3_TEST_ACCESS_KEY_ID ?? "veritio";
const secretAccessKey = process.env.VERITIO_S3_TEST_SECRET_ACCESS_KEY ?? "veritio-local";
const bucket = process.env.VERITIO_S3_TEST_BUCKET ?? "veritio-archive";

if (endpoint) {
  defineObjectArchiveLiveSuite(endpoint);
}

/**
 * Proves the object archive against a real S3-compatible endpoint (MinIO in
 * `storage/docker-compose.yml`; the same API surface Cloudflare R2 and AWS S3
 * expose), including byte-exact round-trips and fail-closed corruption
 * detection through a real network + storage boundary.
 */
function defineObjectArchiveLiveSuite(liveEndpoint: string): void {
  const s3 = new S3Client({ endpoint: liveEndpoint, accessKeyId, secretAccessKey, bucket });
  const runPrefix = `it-${crypto.randomUUID()}`;
  const client = createBunS3ArchiveClient(s3);

  describe("object archive live (s3-compatible)", () => {
    test("archives, round-trips, and verifies a tenant chain end to end", async () => {
      await waitForBucket();
      const tenantId = "org_live_archive";
      const archive = createObjectAuditArchive({ client, prefix: runPrefix });
      const store = new MemoryAuditStore();
      for (let index = 1; index <= 5; index += 1) {
        await store.append(
          createAuditEvent({
            id: `evt_${String(index).padStart(3, "0")}`,
            occurredAt: "2026-06-10T00:00:00.000Z",
            actor: { type: "user", id: "usr_live" },
            action: "org.member.invited",
            target: { type: "organization", id: tenantId },
            scope: { tenantId, environment: "test" },
            metadata: { index: String(index) },
          }),
        );
      }
      const records = await store.list({ tenantId });

      try {
        const sealed = await archiveAuditStoreTenant({ archive, store, tenantId, segmentRecordCount: 3 });
        expect(sealed.map((manifest) => [manifest.fromSequence, manifest.toSequence])).toEqual([
          [1, 3],
          [4, 5],
        ]);

        // Idempotent replay of an already-sealed range through the live API.
        const replayed = await archive.sealSegment(records.slice(0, 3));
        expect(replayed).toEqual(sealed[0]!);

        const manifests = await archive.listSegments(tenantId);
        expect(manifests).toHaveLength(2);
        const restored = await archive.readSegment(manifests[0]!);
        expect(restored.map((record) => canonicalJson(record))).toEqual(
          records.slice(0, 3).map((record) => canonicalJson(record)),
        );

        // Edge chain archives independently and verifies together with events.
        const edgeManifest = await archive.sealEdgeSegment(seedEdgeRecords(tenantId, 2));
        expect(edgeManifest.segmentKey).toContain("/edges/");

        const verification = await archive.verifyTenant(tenantId);
        expect(verification).toEqual({
          ok: true,
          audit: { ok: true, segmentCount: 2, recordCount: 5, verification: { ok: true } },
          edges: { ok: true, segmentCount: 1, recordCount: 2, verification: { ok: true } },
        });

        // Corrupt the stored segment bytes behind the manifest's back and
        // prove verification fails closed across the real storage boundary.
        await s3.write(manifests[1]!.segmentKey, new TextEncoder().encode('{"not":"a record"}\n'));
        const corrupted = await archive.verifyTenant(tenantId);
        expect(corrupted.ok).toBe(false);
        expect(corrupted.audit.reason).toBe("archived segment integrity check failed");
        expect(corrupted.edges.ok).toBe(true);
      } finally {
        for (const key of await client.list(`${runPrefix}/`)) {
          await s3.delete(key);
        }
      }
    }, 60_000);
  });

  /**
   * Retries an initial list so MinIO container startup delay cannot make the
   * live suite flaky, mirroring `waitForConnection` in the SQL suites.
   */
  async function waitForBucket(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await s3.list({ prefix: `${runPrefix}/`, maxKeys: 1 });
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    throw lastError;
  }
}

/**
 * Builds a valid hash-linked edge-record chain the same way the file store
 * does: core `createEvidenceEdge` + envelope + `hashEvidenceEdgeRecord`.
 */
function seedEdgeRecords(tenantId: string, count: number): EvidenceEdgeRecord[] {
  const records: EvidenceEdgeRecord[] = [];
  for (let index = 1; index <= count; index += 1) {
    const edge = createEvidenceEdge({
      id: `edge_${String(index).padStart(3, "0")}`,
      occurredAt: "2026-06-10T00:00:00.000Z",
      from: { type: "tool_call", id: `tc_${index}` },
      relation: "modified",
      to: { type: "file", id: `file_${index}` },
      scope: { tenantId, environment: "test" },
    });
    const tip = records[records.length - 1];
    const withoutHash = {
      edge,
      sequence: index,
      previousHash: tip?.hash ?? null,
      hashAlgorithm: "sha256" as const,
      canonicalization: "veritio-json-v1" as const,
      appendedAt: "2026-06-10T00:00:00.000Z",
      idempotencyKeyHash: hashIdempotencyKey(tenantId, edge.id),
    };
    records.push({ ...withoutHash, hash: hashEvidenceEdgeRecord(withoutHash) });
  }
  return records;
}

/**
 * Adapts Bun's built-in S3 client to the injected ObjectArchiveClient
 * contract: bytes in/out, missing keys as null, and list pagination drained
 * so the archive always sees every key under a prefix.
 */
function createBunS3ArchiveClient(s3: S3Client): ObjectArchiveClient {
  return {
    async put(key, body) {
      await s3.write(key, body);
    },
    async get(key) {
      try {
        return new Uint8Array(await s3.file(key).arrayBuffer());
      } catch (error) {
        if ((error as { code?: string }).code === "NoSuchKey") {
          return null;
        }
        throw error;
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      for (;;) {
        const page = await s3.list({ prefix, ...(continuationToken ? { continuationToken } : {}) });
        for (const item of page.contents ?? []) {
          keys.push(item.key);
        }
        if (!page.isTruncated || !page.nextContinuationToken) {
          return keys;
        }
        continuationToken = page.nextContinuationToken;
      }
    },
  };
}
