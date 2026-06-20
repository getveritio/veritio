import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  type AuditEvent,
  type AuditEventInput,
  type AuditRecord,
  type EvidenceEdge,
  type EvidenceEdgeInput,
  type EvidenceEdgeRecord,
  HASH_ALGORITHM,
  canonicalJson,
  createAuditEvent,
  createEvidenceEdge,
  hashAuditRecord,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  type VerificationResult,
  verifyAuditRecords,
  verifyEvidenceEdgeRecords,
} from "@veritio/core";

const CANONICALIZATION = "veritio-json-v1" as const;

/** Combined event + edge chain verification for a file store. */
export type FileEvidenceVerification = {
  ok: boolean;
  audit: VerificationResult;
  edges: VerificationResult;
};

/**
 * Durable, hash-chained, file-backed evidence sink. It implements the recorder's
 * `ProvenanceSinks` (recordEvent/recordEdge) AND read/verify helpers, so a tool
 * that runs as a fresh process per event (e.g. a Claude Code hook) can append to
 * one tenant's chains across invocations and a reader (the reference MCP) can list
 * and verify them.
 *
 * Append semantics — idempotent replay (by record id), previous-hash linkage,
 * monotonic sequence, record hashing — mirror `@veritio/core`'s `MemoryAuditStore`
 * exactly; hashing/verification come from the core primitives and are never
 * reimplemented here. Events and edges are independent JSONL chains under `dir`.
 */
export interface FileEvidenceStore {
  recordEvent(input: AuditEventInput): Promise<AuditRecord>;
  recordEdge(input: EvidenceEdgeInput): Promise<EvidenceEdgeRecord>;
  listEvents(): Promise<AuditRecord[]>;
  listEdges(): Promise<EvidenceEdgeRecord[]>;
  verify(): Promise<FileEvidenceVerification>;
}

/**
 * Opens (creating if needed) a file-backed evidence store rooted at `dir`. The
 * caller owns `dir`; one directory holds exactly one tenant's event + edge chains.
 */
export function createFileEvidenceStore(dir: string): FileEvidenceStore {
  const eventsPath = join(dir, "events.jsonl");
  const edgesPath = join(dir, "edges.jsonl");

  return {
    async recordEvent(input) {
      const event = createAuditEvent(input);
      requireTenantId(event.scope?.tenantId);
      return withLock(dir, async () => {
        const records = await readJsonl<AuditRecord>(eventsPath);
        const idempotencyKeyHash = hashIdempotencyKey(event.scope!.tenantId as string, event.id);
        const existing = records.find((record) => record.idempotencyKeyHash === idempotencyKeyHash);
        if (existing) {
          if (canonicalJson(existing.event) !== canonicalJson(event)) {
            throw new TypeError("idempotency conflict");
          }
          return existing;
        }
        const tip = records[records.length - 1];
        const recordWithoutHash: Omit<AuditRecord, "hash"> = {
          event,
          sequence: (tip?.sequence ?? 0) + 1,
          previousHash: tip?.hash ?? null,
          hashAlgorithm: HASH_ALGORITHM,
          canonicalization: CANONICALIZATION,
          appendedAt: new Date().toISOString(),
          idempotencyKeyHash,
        };
        const record: AuditRecord = { ...recordWithoutHash, hash: hashAuditRecord(recordWithoutHash) };
        await appendJsonl(dir, eventsPath, record);
        return record;
      });
    },

    async recordEdge(input) {
      const edge = createEvidenceEdge(input);
      requireTenantId(edge.scope?.tenantId);
      return withLock(dir, async () => {
        const records = await readJsonl<EvidenceEdgeRecord>(edgesPath);
        const idempotencyKeyHash = hashIdempotencyKey(edge.scope!.tenantId as string, edge.id);
        const existing = records.find((record) => record.idempotencyKeyHash === idempotencyKeyHash);
        if (existing) {
          if (canonicalJson(existing.edge) !== canonicalJson(edge)) {
            throw new TypeError("idempotency conflict");
          }
          return existing;
        }
        const tip = records[records.length - 1];
        const recordWithoutHash: Omit<EvidenceEdgeRecord, "hash"> = {
          edge,
          sequence: (tip?.sequence ?? 0) + 1,
          previousHash: tip?.hash ?? null,
          hashAlgorithm: HASH_ALGORITHM,
          canonicalization: CANONICALIZATION,
          appendedAt: new Date().toISOString(),
          idempotencyKeyHash,
        };
        const record: EvidenceEdgeRecord = { ...recordWithoutHash, hash: hashEvidenceEdgeRecord(recordWithoutHash) };
        await appendJsonl(dir, edgesPath, record);
        return record;
      });
    },

    listEvents: () => readJsonl<AuditRecord>(eventsPath),
    listEdges: () => readJsonl<EvidenceEdgeRecord>(edgesPath),

    async verify() {
      const audit = verifyAuditRecords(await readJsonl<AuditRecord>(eventsPath));
      const edges = verifyEvidenceEdgeRecords(await readJsonl<EvidenceEdgeRecord>(edgesPath));
      return { ok: audit.ok && edges.ok, audit, edges };
    },
  };
}

/** Fails closed when a record carries no tenant scope so a tenantless row can never enter a chain. */
function requireTenantId(tenantId: string | undefined): void {
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new TypeError("scope.tenantId is required");
  }
}

/** Reads a JSONL file into typed records, treating a missing file as an empty chain. */
async function readJsonl<T>(path: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

/** Appends one record as a JSONL line, creating the directory on first write. */
async function appendJsonl(dir: string, path: string, record: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  const handle = await open(path, "a");
  try {
    await handle.appendFile(`${JSON.stringify(record)}\n`, "utf8");
  } finally {
    await handle.close();
  }
}

/**
 * Serializes read-modify-write across processes with an exclusive-create lock file
 * so two concurrent hook processes cannot fork a tenant's chain. Best-effort with a
 * bounded retry; a stale lock from a crashed writer is the documented edge to clear.
 */
async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lockPath = join(dir, ".lock");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        return await fn();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => {});
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 500) {
        throw error;
      }
      await delay(10);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
