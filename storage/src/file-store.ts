import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  type AuditEvent,
  type AuditEventInput,
  type AuditRecord,
  type EvidenceCommit,
  type EvidenceCommitInput,
  type EvidenceCommitVerificationResult,
  type EvidenceEdge,
  type EvidenceEdgeInput,
  type EvidenceEdgeRecord,
  HASH_ALGORITHM,
  canonicalJson,
  createAuditEvent,
  createEvidenceCommit,
  createEvidenceEdge,
  hashAuditRecord,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  type VerificationResult,
  verifyAuditRecords,
  verifyEvidenceCommits,
  verifyEvidenceEdgeRecords,
} from "@veritio/core";

const CANONICALIZATION = "veritio-json-v1" as const;

/** Combined event + edge chain verification for a file store. */
export type FileEvidenceVerification = {
  ok: boolean;
  audit: VerificationResult;
  edges: VerificationResult;
  commits: EvidenceCommitVerificationResult;
};

export interface FileEvidenceBatchInput {
  commitId: string;
  streamId: string;
  events: AuditEventInput[];
  edges: EvidenceEdgeInput[];
  committedAt?: string | Date;
}

export interface FileEvidenceBatchResult {
  events: AuditRecord[];
  edges: EvidenceEdgeRecord[];
  commit: EvidenceCommit;
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
  recordBatch(input: FileEvidenceBatchInput): Promise<FileEvidenceBatchResult>;
  listEvents(): Promise<AuditRecord[]>;
  listEdges(): Promise<EvidenceEdgeRecord[]>;
  listCommits(): Promise<EvidenceCommit[]>;
  verify(): Promise<FileEvidenceVerification>;
}

/**
 * Opens (creating if needed) a file-backed evidence store rooted at `dir`. The
 * caller owns `dir`; one directory holds exactly one tenant's event + edge chains.
 */
export function createFileEvidenceStore(dir: string): FileEvidenceStore {
  const eventsPath = join(dir, "events.jsonl");
  const edgesPath = join(dir, "edges.jsonl");
  const commitsPath = join(dir, "commits.jsonl");

  return {
    async recordEvent(input) {
      const event = createAuditEvent(input);
      requireTenantId(event.scope?.tenantId);
      return withLock(dir, async () => {
        const records = await readJsonl<AuditRecord>(eventsPath);
        const { record, appended } = appendEventRecord(records, event);
        if (appended) {
          await appendJsonl(dir, eventsPath, record);
        }
        return record;
      });
    },

    async recordEdge(input) {
      const edge = createEvidenceEdge(input);
      requireTenantId(edge.scope?.tenantId);
      return withLock(dir, async () => {
        const records = await readJsonl<EvidenceEdgeRecord>(edgesPath);
        const { record, appended } = appendEdgeRecord(records, edge);
        if (appended) {
          await appendJsonl(dir, edgesPath, record);
        }
        return record;
      });
    },

    async recordBatch(input) {
      return withLock(dir, async () => {
        const eventRecords = await readJsonl<AuditRecord>(eventsPath);
        const edgeRecords = await readJsonl<EvidenceEdgeRecord>(edgesPath);
        const commits = await readJsonl<EvidenceCommit>(commitsPath);
        const appendedEvents = input.events.map((eventInput) => {
          const event = createAuditEvent(eventInput);
          requireTenantId(event.scope?.tenantId);
          return appendEventRecord(eventRecords, event);
        });
        const appendedEdges = input.edges.map((edgeInput) => {
          const edge = createEvidenceEdge(edgeInput);
          requireTenantId(edge.scope?.tenantId);
          return appendEdgeRecord(edgeRecords, edge);
        });
        if (appendedEvents.length + appendedEdges.length === 0) {
          throw new TypeError("batch must include at least one event or edge");
        }

        const members = [
          ...appendedEvents.map(({ record }, index) => ({
            index,
            recordType: "audit.record" as const,
            recordId: record.event.id,
            recordHash: `sha256:${record.hash}`,
          })),
          ...appendedEdges.map(({ record }, index) => ({
            index: appendedEvents.length + index,
            recordType: "evidence.edge.record" as const,
            recordId: record.edge.id,
            recordHash: `sha256:${record.hash}`,
          })),
        ];
        const existingCommit = commits.find((commit) => commit.streamId === input.streamId && commit.commitId === input.commitId);
        if (existingCommit) {
          if (canonicalJson(existingCommit.members) !== canonicalJson(members)) {
            throw new TypeError("commit id conflict");
          }
          return {
            events: appendedEvents.map(({ record }) => record),
            edges: appendedEdges.map(({ record }) => record),
            commit: existingCommit,
          };
        }

        const previousCommit = commits.filter((commit) => commit.streamId === input.streamId).at(-1);
        const commitInput: EvidenceCommitInput = {
          commitId: input.commitId,
          streamId: input.streamId,
          sequence: (previousCommit?.sequence ?? 0) + 1,
          previousCommitHash: previousCommit?.hash ?? null,
          members,
        };
        if (input.committedAt !== undefined) {
          commitInput.committedAt = input.committedAt;
        }
        const commit = createEvidenceCommit(commitInput);

        for (const { record, appended } of appendedEvents) {
          if (!appended) {
            continue;
          }
          await appendJsonl(dir, eventsPath, record);
        }
        for (const { record, appended } of appendedEdges) {
          if (!appended) {
            continue;
          }
          await appendJsonl(dir, edgesPath, record);
        }
        await appendJsonl(dir, commitsPath, commit);
        return { events: appendedEvents.map(({ record }) => record), edges: appendedEdges.map(({ record }) => record), commit };
      });
    },

    listEvents: () => readJsonl<AuditRecord>(eventsPath),
    listEdges: () => readJsonl<EvidenceEdgeRecord>(edgesPath),
    listCommits: () => readJsonl<EvidenceCommit>(commitsPath),

    async verify() {
      const audit = verifyAuditRecords(await readJsonl<AuditRecord>(eventsPath));
      const edges = verifyEvidenceEdgeRecords(await readJsonl<EvidenceEdgeRecord>(edgesPath));
      const commits = verifyEvidenceCommits(await readJsonl<EvidenceCommit>(commitsPath));
      return { ok: audit.ok && edges.ok && commits.ok, audit, edges, commits };
    },
  };
}

/** Appends or replays one event record in an already locked file-store transaction. */
function appendEventRecord(records: AuditRecord[], event: AuditEvent): { record: AuditRecord; appended: boolean } {
  const idempotencyKeyHash = hashIdempotencyKey(event.scope!.tenantId as string, event.id);
  const existing = records.find((record) => record.idempotencyKeyHash === idempotencyKeyHash);
  if (existing) {
    if (canonicalJson(existing.event) !== canonicalJson(event)) {
      throw new TypeError("idempotency conflict");
    }
    return { record: existing, appended: false };
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
  records.push(record);
  return { record, appended: true };
}

/** Appends or replays one edge record in an already locked file-store transaction. */
function appendEdgeRecord(records: EvidenceEdgeRecord[], edge: EvidenceEdge): { record: EvidenceEdgeRecord; appended: boolean } {
  const idempotencyKeyHash = hashIdempotencyKey(edge.scope!.tenantId as string, edge.id);
  const existing = records.find((record) => record.idempotencyKeyHash === idempotencyKeyHash);
  if (existing) {
    if (canonicalJson(existing.edge) !== canonicalJson(edge)) {
      throw new TypeError("idempotency conflict");
    }
    return { record: existing, appended: false };
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
  records.push(record);
  return { record, appended: true };
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
