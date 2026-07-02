import { describe, expect, test } from "bun:test";
import {
  type AuditRecord,
  canonicalJson,
  createAuditEvent,
  createEvidenceEdge,
  type EvidenceEdgeRecord,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  MemoryAuditStore,
} from "@veritio/core";
import { archiveAuditStoreTenant, createObjectAuditArchive, type ObjectArchiveClient } from "../object-archive";

const TENANT = "org_archive";

/**
 * In-memory ObjectArchiveClient fake exposing the raw object map so tests can
 * corrupt or delete stored bytes to prove fail-closed reads.
 */
function createMemoryObjectClient(): ObjectArchiveClient & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, body) {
      objects.set(key, body.slice());
    },
    async get(key) {
      const body = objects.get(key);
      return body ? body.slice() : null;
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
  };
}

/** Builds a deterministic valid audit event for one tenant chain. */
function makeEvent(index: number, tenantId: string = TENANT) {
  return createAuditEvent({
    id: `evt_${String(index).padStart(3, "0")}`,
    occurredAt: "2026-06-10T00:00:00.000Z",
    actor: { type: "user", id: `usr_${tenantId}` },
    action: "org.member.invited",
    target: { type: "organization", id: tenantId },
    scope: { tenantId, environment: "test" },
    metadata: { index: String(index) },
  });
}

/** Appends `count` events through the in-memory reference store and returns the chained records. */
async function seedRecords(count: number, tenantId: string = TENANT): Promise<AuditRecord[]> {
  const store = new MemoryAuditStore();
  for (let index = 1; index <= count; index += 1) {
    await store.append(makeEvent(index, tenantId));
  }
  return store.list({ tenantId });
}

/**
 * Builds a valid hash-linked edge-record chain the same way the file store
 * does: core `createEvidenceEdge` + envelope + `hashEvidenceEdgeRecord`.
 */
function seedEdgeRecords(count: number, tenantId: string = TENANT): EvidenceEdgeRecord[] {
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

describe("object audit archive", () => {
  test("seals a segment and reads back byte-identical records", async () => {
    const client = createMemoryObjectClient();
    const archive = createObjectAuditArchive({ client });
    const records = await seedRecords(3);

    const manifest = await archive.sealSegment(records);

    expect(manifest.tenantId).toBe(TENANT);
    expect(manifest.fromSequence).toBe(1);
    expect(manifest.toSequence).toBe(3);
    expect(manifest.recordCount).toBe(3);
    expect(manifest.firstPreviousHash).toBeNull();
    expect(manifest.lastHash).toBe(records[2]!.hash);

    const restored = await archive.readSegment(manifest);
    expect(restored.map((record) => canonicalJson(record))).toEqual(records.map((record) => canonicalJson(record)));
  });

  test("requires the first sealed segment to start at the chain origin", async () => {
    const archive = createObjectAuditArchive({ client: createMemoryObjectClient() });
    const records = await seedRecords(4);

    await expect(archive.sealSegment(records.slice(1))).rejects.toThrow(
      "archive must start at the tenant chain origin",
    );
    await expect(archive.sealSegment([])).rejects.toThrow("segment requires at least one record");
  });

  test("rejects segments that do not extend the archived tip", async () => {
    const archive = createObjectAuditArchive({ client: createMemoryObjectClient() });
    const records = await seedRecords(6);
    await archive.sealSegment(records.slice(0, 2));

    await expect(archive.sealSegment(records.slice(3))).rejects.toThrow(
      "segment does not extend the archived tenant chain",
    );
  });

  test("replays an identical sealed range idempotently and rejects conflicting overlaps", async () => {
    const archive = createObjectAuditArchive({ client: createMemoryObjectClient() });
    const records = await seedRecords(4);
    const manifest = await archive.sealSegment(records.slice(0, 2));

    const replayed = await archive.sealSegment(records.slice(0, 2));
    expect(replayed).toEqual(manifest);

    await expect(archive.sealSegment(records.slice(0, 3))).rejects.toThrow("segment conflict");
  });

  test("fails closed before writing when segment records are invalid", async () => {
    const client = createMemoryObjectClient();
    const archive = createObjectAuditArchive({ client });
    const records = await seedRecords(3);
    const foreign = await seedRecords(1, "org_other");

    await expect(archive.sealSegment([records[0]!, foreign[0]!])).rejects.toThrow(
      "segment must contain a single tenant chain",
    );
    await expect(archive.sealSegment([records[0]!, records[2]!])).rejects.toThrow(
      "segment records must be contiguous and hash-linked",
    );
    const tampered = { ...records[0]!, appendedAt: "2030-01-01T00:00:00.000Z" };
    await expect(archive.sealSegment([tampered])).rejects.toThrow("record integrity check failed");
    expect(client.objects.size).toBe(0);
  });

  test("fails closed when archived segment bytes are corrupted", async () => {
    const client = createMemoryObjectClient();
    const archive = createObjectAuditArchive({ client });
    const records = await seedRecords(2);
    const manifest = await archive.sealSegment(records);

    const stored = client.objects.get(manifest.segmentKey)!;
    stored[0] = stored[0] === 0x7b ? 0x5b : 0x7b;
    client.objects.set(manifest.segmentKey, stored);

    await expect(archive.readSegment(manifest)).rejects.toThrow("archived segment integrity check failed");
    const verification = await archive.verifyTenant(TENANT);
    expect(verification.ok).toBe(false);
    expect(verification.audit.reason).toBe("archived segment integrity check failed");
    expect(verification.edges.ok).toBe(true);
  });

  test("verifies a multi-segment tenant chain end to end", async () => {
    const archive = createObjectAuditArchive({ client: createMemoryObjectClient() });
    const records = await seedRecords(6);
    await archive.sealSegment(records.slice(0, 2));
    await archive.sealSegment(records.slice(2, 4));
    await archive.sealSegment(records.slice(4));

    const verification = await archive.verifyTenant(TENANT);
    expect(verification).toEqual({
      ok: true,
      audit: { ok: true, segmentCount: 3, recordCount: 6, verification: { ok: true } },
      edges: { ok: true, segmentCount: 0, recordCount: 0, verification: null },
    });
  });

  test("reports missing middle segments as a continuity failure", async () => {
    const client = createMemoryObjectClient();
    const archive = createObjectAuditArchive({ client });
    const records = await seedRecords(6);
    await archive.sealSegment(records.slice(0, 2));
    const middle = await archive.sealSegment(records.slice(2, 4));
    await archive.sealSegment(records.slice(4));

    client.objects.delete(`${middle.segmentKey}.manifest.json`);

    const verification = await archive.verifyTenant(TENANT);
    expect(verification.ok).toBe(false);
    expect(verification.audit.reason).toBe("archived segments are not contiguous");
  });

  test("verifies an empty archive trivially", async () => {
    const archive = createObjectAuditArchive({ client: createMemoryObjectClient() });
    await expect(archive.verifyTenant(TENANT)).resolves.toEqual({
      ok: true,
      audit: { ok: true, segmentCount: 0, recordCount: 0, verification: null },
      edges: { ok: true, segmentCount: 0, recordCount: 0, verification: null },
    });
  });

  test("archives both protocol chains independently and verifies them together", async () => {
    const client = createMemoryObjectClient();
    const archive = createObjectAuditArchive({ client });
    const events = await seedRecords(3);
    const edges = seedEdgeRecords(4);

    await archive.sealSegment(events);
    await archive.sealEdgeSegment(edges.slice(0, 2));
    await archive.sealEdgeSegment(edges.slice(2));

    const edgeManifests = await archive.listEdgeSegments(TENANT);
    expect(edgeManifests.map((manifest) => [manifest.fromSequence, manifest.toSequence])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(edgeManifests[0]!.segmentKey).toContain("/edges/");

    const restored = await archive.readEdgeSegment(edgeManifests[0]!);
    expect(restored.map((record) => canonicalJson(record))).toEqual(
      edges.slice(0, 2).map((record) => canonicalJson(record)),
    );

    const verification = await archive.verifyTenant(TENANT);
    expect(verification).toEqual({
      ok: true,
      audit: { ok: true, segmentCount: 1, recordCount: 3, verification: { ok: true } },
      edges: { ok: true, segmentCount: 2, recordCount: 4, verification: { ok: true } },
    });
  });

  test("an edge-chain failure fails the combined verification while the event chain stays ok", async () => {
    const client = createMemoryObjectClient();
    const archive = createObjectAuditArchive({ client });
    await archive.sealSegment(await seedRecords(2));
    const edgeManifest = await archive.sealEdgeSegment(seedEdgeRecords(2));

    const stored = client.objects.get(edgeManifest.segmentKey)!;
    stored[0] = stored[0] === 0x7b ? 0x5b : 0x7b;
    client.objects.set(edgeManifest.segmentKey, stored);

    const verification = await archive.verifyTenant(TENANT);
    expect(verification.ok).toBe(false);
    expect(verification.audit.ok).toBe(true);
    expect(verification.edges.ok).toBe(false);
    expect(verification.edges.reason).toBe("archived segment integrity check failed");
  });

  test("rejects tampered edge records before writing", async () => {
    const client = createMemoryObjectClient();
    const archive = createObjectAuditArchive({ client });
    const edges = seedEdgeRecords(2);

    const tampered = { ...edges[0]!, appendedAt: "2030-01-01T00:00:00.000Z" };
    await expect(archive.sealEdgeSegment([tampered, edges[1]!])).rejects.toThrow("record integrity check failed");
    expect(client.objects.size).toBe(0);
  });

  test("archives an audit store incrementally and resumes from the archive tip", async () => {
    const archive = createObjectAuditArchive({ client: createMemoryObjectClient() });
    const store = new MemoryAuditStore();
    for (let index = 1; index <= 5; index += 1) {
      await store.append(makeEvent(index));
    }

    const first = await archiveAuditStoreTenant({ archive, store, tenantId: TENANT, segmentRecordCount: 2 });
    expect(first.map((manifest) => [manifest.fromSequence, manifest.toSequence])).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ]);

    await store.append(makeEvent(6));
    await store.append(makeEvent(7));
    const second = await archiveAuditStoreTenant({ archive, store, tenantId: TENANT, segmentRecordCount: 2 });
    expect(second.map((manifest) => [manifest.fromSequence, manifest.toSequence])).toEqual([[6, 7]]);

    const verification = await archive.verifyTenant(TENANT);
    expect(verification.ok).toBe(true);
    expect(verification.audit.recordCount).toBe(7);
  });
});
