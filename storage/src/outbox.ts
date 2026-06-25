import { mkdir, open, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  AuditEventInput,
  AuditRecord,
  EvidenceEdgeInput,
  EvidenceEdgeRecord,
  GovernedChangeDraft,
} from "@veritio/core";
import { canonicalJson } from "@veritio/core";

export type OutboxPayload = GovernedChangeDraft["outboxEntry"];
export type OutboxStatus = "pending" | "dispatched";

export interface OutboxEnqueueInput {
  id: string;
  tenantId: string;
  payload: OutboxPayload;
  availableAt?: string | Date;
}

export interface OutboxStoredEntry extends OutboxEnqueueInput {
  availableAt: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  lastError?: string;
}

export interface OutboxListOptions {
  tenantId?: string;
  limit?: number;
  now?: string | Date;
}

export interface OutboxTransaction {
  enqueue(input: OutboxEnqueueInput): Promise<OutboxStoredEntry>;
}

export interface OutboxAdapter {
  transaction<T>(run: (tx: OutboxTransaction) => Promise<T>): Promise<T>;
  list(options?: OutboxListOptions): Promise<OutboxStoredEntry[]>;
  listDispatchable(options?: OutboxListOptions): Promise<OutboxStoredEntry[]>;
  markDispatched(id: string, options?: { dispatchedAt?: string | Date }): Promise<OutboxStoredEntry>;
  markFailed(id: string, error: unknown, options?: { now?: string | Date; availableAt?: string | Date }): Promise<OutboxStoredEntry>;
}

export interface OutboxEvidenceTarget {
  recordEvent(input: AuditEventInput): Promise<AuditRecord>;
  recordEdge(input: EvidenceEdgeInput): Promise<EvidenceEdgeRecord>;
}

export interface OutboxDispatcher {
  dispatchBatch(options?: OutboxListOptions): Promise<{ dispatched: number; failed: number }>;
}

export const POSTGRES_OUTBOX_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS veritio_outbox_entries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  payload_canonical text NOT NULL,
  entry_json text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL,
  available_at text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  dispatched_at text,
  last_error text
);

CREATE INDEX IF NOT EXISTS veritio_outbox_dispatch_idx
  ON veritio_outbox_entries (status, available_at, tenant_id, created_at, id);`;

export const MYSQL_OUTBOX_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS \`veritio_outbox_entries\` (
  \`id\` varchar(255) PRIMARY KEY,
  \`tenant_id\` varchar(255) NOT NULL,
  \`payload_canonical\` longtext NOT NULL,
  \`entry_json\` longtext NOT NULL,
  \`status\` varchar(32) NOT NULL,
  \`attempts\` integer NOT NULL,
  \`available_at\` varchar(40) NOT NULL,
  \`created_at\` varchar(40) NOT NULL,
  \`updated_at\` varchar(40) NOT NULL,
  \`dispatched_at\` varchar(40),
  \`last_error\` longtext,
  KEY \`veritio_outbox_dispatch_idx\` (\`status\`, \`available_at\`, \`tenant_id\`, \`created_at\`, \`id\`)
);`;

export interface SqlOutboxRow {
  id: string;
  tenant_id: string;
  payload_canonical: string;
  entry_json: string;
  status: string;
  attempts: number;
  available_at: string;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
  last_error: string | null;
}

export type SqlOutboxQueryResult =
  | readonly Record<string, unknown>[]
  | { rows: readonly Record<string, unknown>[] }
  | [readonly Record<string, unknown>[], unknown];

export interface SqlOutboxSession {
  execute(statement: string, params: readonly unknown[]): Promise<SqlOutboxQueryResult>;
}

export interface SqlOutboxExecutor extends SqlOutboxSession {
  transaction<T>(run: (session: SqlOutboxSession) => Promise<T>): Promise<T>;
}

export interface SqlOutboxAdapterOptions {
  client: SqlOutboxExecutor;
  tableName?: string;
}

type SqlDialect = "postgres" | "mysql";

const OUTBOX_SCHEMA_VERSION = "2026-06-23";
const DEFAULT_SQL_OUTBOX_TABLE = "veritio_outbox_entries";

/**
 * Creates a durable local outbox adapter for OSS examples, tests, and self-hosted
 * deployments that need transaction-like evidence staging without a database
 * driver dependency. Host SQL/Mongo adapters should preserve the same interface
 * inside their own native transaction boundaries.
 */
export function createFileOutboxAdapter(dir: string): OutboxAdapter {
  return new FileOutboxAdapter(dir);
}

/**
 * Creates a Postgres-backed transactional outbox using a host-injected executor
 * so application mutations and evidence rows can share one database transaction.
 */
export function createPostgresOutboxAdapter(options: SqlOutboxAdapterOptions): OutboxAdapter {
  return new SqlOutboxAdapter("postgres", options);
}

/**
 * Creates a Neon-compatible outbox through the Postgres dialect because Neon
 * preserves the transaction semantics required by the outbox contract.
 */
export function createNeonOutboxAdapter(options: SqlOutboxAdapterOptions): OutboxAdapter {
  return createPostgresOutboxAdapter(options);
}

/**
 * Creates a MySQL-backed transactional outbox using a host-provided transaction
 * executor and the same payload validation as the Postgres adapter.
 */
export function createMysqlOutboxAdapter(options: SqlOutboxAdapterOptions): OutboxAdapter {
  return new SqlOutboxAdapter("mysql", options);
}

/**
 * Creates a MariaDB-compatible transactional outbox through the MySQL dialect.
 */
export function createMariaDbOutboxAdapter(options: SqlOutboxAdapterOptions): OutboxAdapter {
  return createMysqlOutboxAdapter(options);
}

/**
 * Compatibility alias for callers that spell MariaDB with an all-caps DB.
 */
export function createMariaDBOutboxAdapter(options: SqlOutboxAdapterOptions): OutboxAdapter {
  return createMariaDbOutboxAdapter(options);
}

/**
 * Creates the retry loop that drains pending outbox rows into an evidence sink.
 * The dispatcher does not claim EvidenceCommit atomicity; it relies on record and
 * edge IDs for duplicate-safe retries until the EvidenceCommit protocol lands.
 */
export function createOutboxDispatcher(options: {
  adapter: OutboxAdapter;
  target: OutboxEvidenceTarget;
}): OutboxDispatcher {
  return {
    /**
     * Dispatches currently available rows in deterministic order, recording
     * failures back to the outbox so a later retry can continue idempotently.
     */
    async dispatchBatch(listOptions = {}) {
      let dispatched = 0;
      let failed = 0;
      const entries = await options.adapter.listDispatchable(listOptions);
      for (const entry of entries) {
        try {
          await dispatchOutboxEntry(entry.payload, options.target);
          await options.adapter.markDispatched(
            entry.id,
            listOptions.now === undefined ? {} : { dispatchedAt: listOptions.now },
          );
          dispatched += 1;
        } catch (error) {
          await options.adapter.markFailed(entry.id, error, listOptions.now === undefined ? {} : { now: listOptions.now });
          failed += 1;
        }
      }
      return { dispatched, failed };
    },
  };
}

/**
 * Delivers one minimized governed-change outbox payload to an evidence sink.
 * Re-running this function with the same payload must be safe because event and
 * edge IDs are deterministic and downstream stores enforce idempotency conflicts.
 */
export async function dispatchOutboxEntry(payload: OutboxPayload, target: OutboxEvidenceTarget): Promise<void> {
  validatePayload(payload);
  for (const record of payload.records) {
    await target.recordEvent(record);
  }
  for (const edge of payload.edges) {
    await target.recordEdge(edge);
  }
}

/**
 * SQL implementation shared by Postgres, Neon, MySQL, and MariaDB. It keeps the
 * transactional boundary host-owned while giving OSS users a concrete database
 * outbox adapter with deterministic tenant validation and retry state.
 */
class SqlOutboxAdapter implements OutboxAdapter {
  readonly #client: SqlOutboxExecutor;
  readonly #dialect: SqlDialect;
  readonly #table: string;

  /**
   * Stores the host executor and validates the table identifier before any SQL
   * statement is generated.
   */
  constructor(dialect: SqlDialect, options: SqlOutboxAdapterOptions) {
    this.#dialect = dialect;
    this.#client = options.client;
    this.#table = quoteTableName(options.tableName ?? DEFAULT_SQL_OUTBOX_TABLE, dialect);
  }

  /**
   * Runs enqueue operations inside the host transaction so the application
   * mutation and minimized outbox row can commit or roll back together.
   */
  async transaction<T>(run: (tx: OutboxTransaction) => Promise<T>): Promise<T> {
    return this.#client.transaction(async (session) => {
      const tx: OutboxTransaction = {
        enqueue: (input) => this.#enqueue(session, input),
      };
      return run(tx);
    });
  }

  /**
   * Lists stored rows by deterministic creation order, validating each JSON
   * envelope before it can drive dispatcher behavior.
   */
  async list(options: OutboxListOptions = {}): Promise<OutboxStoredEntry[]> {
    validateListOptions(options);
    const rows = rowsFromResult(
      await this.#client.execute(
        this.#selectEntriesSql(options.limit),
        options.limit === undefined
          ? [options.tenantId ?? null]
          : this.#paramsWithLimit(options.tenantId ?? null, options.limit),
      ),
    );
    return rows.map((row) => entryFromSqlRow(row)).map(cloneEntry);
  }

  /**
   * Lists pending rows whose retry time has arrived, scoped by tenant when the
   * dispatcher is draining a single governance boundary.
   */
  async listDispatchable(options: OutboxListOptions = {}): Promise<OutboxStoredEntry[]> {
    validateListOptions(options);
    const now = normalizeDate(options.now ?? new Date());
    const rows = rowsFromResult(
      await this.#client.execute(
        this.#selectDispatchableSql(options.limit),
        options.limit === undefined
          ? ["pending", now, options.tenantId ?? null]
          : this.#dispatchableParams("pending", now, options.tenantId ?? null, options.limit),
      ),
    );
    return rows.map((row) => entryFromSqlRow(row)).map(cloneEntry);
  }

  /**
   * Marks a SQL row dispatched after successful evidence delivery, preserving a
   * complete serialized row for later audit of dispatcher state.
   */
  async markDispatched(id: string, options: { dispatchedAt?: string | Date } = {}): Promise<OutboxStoredEntry> {
    assertNonEmpty(id, "id");
    return this.#client.transaction(async (session) => {
      const entry = await this.#loadEntry(session, id);
      const dispatchedAt = normalizeDate(options.dispatchedAt ?? new Date());
      entry.status = "dispatched";
      entry.dispatchedAt = dispatchedAt;
      entry.updatedAt = dispatchedAt;
      delete entry.lastError;
      await this.#updateEntry(session, entry);
      return cloneEntry(entry);
    });
  }

  /**
   * Persists a failed dispatch attempt without dropping the payload, allowing a
   * later dispatcher retry to continue from idempotent evidence writes.
   */
  async markFailed(
    id: string,
    error: unknown,
    options: { now?: string | Date; availableAt?: string | Date } = {},
  ): Promise<OutboxStoredEntry> {
    assertNonEmpty(id, "id");
    return this.#client.transaction(async (session) => {
      const entry = await this.#loadEntry(session, id);
      const now = normalizeDate(options.now ?? new Date());
      entry.status = "pending";
      entry.attempts += 1;
      entry.updatedAt = now;
      entry.availableAt = normalizeDate(options.availableAt ?? now);
      entry.lastError = errorMessage(error);
      await this.#updateEntry(session, entry);
      return cloneEntry(entry);
    });
  }

  /**
   * Inserts a staged row or returns an existing idempotent row inside the active
   * host transaction.
   */
  async #enqueue(session: SqlOutboxSession, input: OutboxEnqueueInput): Promise<OutboxStoredEntry> {
    const entry = createPendingEntry(input);
    const payloadCanonical = canonicalJson(entry.payload);
    const existing = firstRow(await session.execute(this.#selectByIdSql(), [entry.id]));
    if (existing) {
      if (readString(existing, "payload_canonical") !== payloadCanonical) {
        throw new TypeError("outbox idempotency conflict");
      }
      const existingEntry = entryFromSqlRow(existing);
      if (!sameEnqueueInput(existingEntry, entry)) {
        throw new TypeError("outbox idempotency conflict");
      }
      return cloneEntry(existingEntry);
    }

    await session.execute(
      this.#insertSql(),
      [
        entry.id,
        entry.tenantId,
        payloadCanonical,
        JSON.stringify(entry),
        entry.status,
        entry.attempts,
        entry.availableAt,
        entry.createdAt,
        entry.updatedAt,
        entry.dispatchedAt ?? null,
        entry.lastError ?? null,
      ],
    );
    return cloneEntry(entry);
  }

  /**
   * Loads one row by ID for status updates.
   */
  async #loadEntry(session: SqlOutboxSession, id: string): Promise<OutboxStoredEntry> {
    const existing = firstRow(await session.execute(this.#selectByIdSql(), [id]));
    if (!existing) {
      throw new TypeError("outbox entry not found");
    }
    return entryFromSqlRow(existing);
  }

  /**
   * Writes the mutated serialized row plus indexed status fields.
   */
  async #updateEntry(session: SqlOutboxSession, entry: OutboxStoredEntry): Promise<void> {
    await session.execute(this.#updateSql(), [
      JSON.stringify(entry),
      entry.status,
      entry.attempts,
      entry.availableAt,
      entry.updatedAt,
      entry.dispatchedAt ?? null,
      entry.lastError ?? null,
      entry.id,
    ]);
  }

  /**
   * Selects one row by ID for idempotency and status transitions.
   */
  #selectByIdSql(): string {
    return `SELECT payload_canonical, entry_json FROM ${this.#table} WHERE id = ${this.#placeholder(1)} LIMIT 1`;
  }

  /**
   * Selects rows in stable dispatcher order, optionally limited by tenant.
   */
  #selectEntriesSql(limitValue: number | undefined): string {
    const limit = limitValue === undefined ? "" : ` LIMIT ${this.#dialect === "mysql" ? limitValue : this.#placeholder(2)}`;
    return `SELECT entry_json FROM ${this.#table} WHERE (${this.#placeholder(1)} IS NULL OR tenant_id = ${this.#placeholder(1)}) ORDER BY created_at ASC, id ASC${limit}`;
  }

  /**
   * Selects due pending rows in stable dispatcher order.
   */
  #selectDispatchableSql(limitValue: number | undefined): string {
    const limit = limitValue === undefined ? "" : ` LIMIT ${this.#dialect === "mysql" ? limitValue : this.#placeholder(4)}`;
    return `SELECT entry_json FROM ${this.#table} WHERE status = ${this.#placeholder(1)} AND available_at <= ${this.#placeholder(2)} AND (${this.#placeholder(3)} IS NULL OR tenant_id = ${this.#placeholder(3)}) ORDER BY created_at ASC, id ASC${limit}`;
  }

  /**
   * Inserts the serialized outbox row and indexed dispatch columns.
   */
  #insertSql(): string {
    return `INSERT INTO ${this.#table} (id, tenant_id, payload_canonical, entry_json, status, attempts, available_at, created_at, updated_at, dispatched_at, last_error) VALUES (${this.#placeholder(1)}, ${this.#placeholder(2)}, ${this.#placeholder(3)}, ${this.#placeholder(4)}, ${this.#placeholder(5)}, ${this.#placeholder(6)}, ${this.#placeholder(7)}, ${this.#placeholder(8)}, ${this.#placeholder(9)}, ${this.#placeholder(10)}, ${this.#placeholder(11)})`;
  }

  /**
   * Updates status and retry metadata for an existing row.
   */
  #updateSql(): string {
    return `UPDATE ${this.#table} SET entry_json = ${this.#placeholder(1)}, status = ${this.#placeholder(2)}, attempts = ${this.#placeholder(3)}, available_at = ${this.#placeholder(4)}, updated_at = ${this.#placeholder(5)}, dispatched_at = ${this.#placeholder(6)}, last_error = ${this.#placeholder(7)} WHERE id = ${this.#placeholder(8)}`;
  }

  /**
   * Returns the placeholder syntax expected by the active SQL dialect.
   */
  #placeholder(index: number): string {
    return this.#dialect === "postgres" ? `$${index}` : "?";
  }

  /**
   * Omits LIMIT parameters for MySQL because its limit value is validated and
   * inlined in the generated statement.
   */
  #paramsWithLimit(tenantId: string | null, limit: number): readonly unknown[] {
    return this.#dialect === "mysql" ? [tenantId] : [tenantId, limit];
  }

  /**
   * Omits LIMIT parameters for MySQL dispatch queries for prepared statement
   * compatibility.
   */
  #dispatchableParams(status: string, now: string, tenantId: string | null, limit: number): readonly unknown[] {
    return this.#dialect === "mysql" ? [status, now, tenantId] : [status, now, tenantId, limit];
  }
}

/**
 * File-backed implementation that persists rows only after the transaction
 * callback resolves, giving local/self-hosted users a concrete outbox adapter
 * while keeping database-specific transaction ownership at the host boundary.
 */
class FileOutboxAdapter implements OutboxAdapter {
  readonly #dir: string;
  readonly #path: string;

  /**
   * Stores the outbox directory and entry file path; the directory is created on
   * first mutation so read-only callers do not create filesystem side effects.
   */
  constructor(dir: string) {
    this.#dir = dir;
    this.#path = join(dir, "entries.json");
  }

  /**
   * Runs a staged outbox transaction under a process-safe file lock. A thrown
   * host mutation error drops the staged rows and leaves durable evidence empty.
   */
  async transaction<T>(run: (tx: OutboxTransaction) => Promise<T>): Promise<T> {
    return withLock(this.#dir, async () => {
      const entries = await readEntries(this.#path);
      const staged = entries.map(cloneEntry);
      const tx: OutboxTransaction = {
        /**
         * Adds an already-minimized payload to the staged outbox snapshot and
         * rejects conflicting IDs before any durable write occurs.
         */
        async enqueue(input) {
          const entry = createPendingEntry(input);
          const existingIndex = staged.findIndex((candidate) => candidate.id === entry.id);
          if (existingIndex !== -1) {
            const existing = staged[existingIndex]!;
            if (!sameEnqueueInput(existing, entry)) {
              throw new TypeError("outbox idempotency conflict");
            }
            return cloneEntry(existing);
          }
          staged.push(entry);
          staged.sort(compareEntries);
          return cloneEntry(entry);
        },
      };

      const result = await run(tx);
      await writeEntries(this.#dir, this.#path, staged);
      return result;
    });
  }

  /**
   * Lists outbox rows by creation order, optionally scoped to one tenant and
   * bounded for dispatcher batches.
   */
  async list(options: OutboxListOptions = {}): Promise<OutboxStoredEntry[]> {
    validateListOptions(options);
    const entries = await readEntries(this.#path);
    return filterEntries(entries, options).map(cloneEntry);
  }

  /**
   * Lists pending rows whose retry time has arrived. Failed rows stay pending so
   * retries can recover from partial evidence delivery without a separate state.
   */
  async listDispatchable(options: OutboxListOptions = {}): Promise<OutboxStoredEntry[]> {
    validateListOptions(options);
    const now = normalizeDate(options.now ?? new Date());
    const entries = await readEntries(this.#path);
    return filterEntries(
      entries.filter((entry) => entry.status === "pending" && entry.availableAt <= now),
      options,
    ).map(cloneEntry);
  }

  /**
   * Marks a row dispatched after every event and edge in its payload reaches the
   * evidence sink. A duplicate mark is harmless for retry coordination.
   */
  async markDispatched(id: string, options: { dispatchedAt?: string | Date } = {}): Promise<OutboxStoredEntry> {
    assertNonEmpty(id, "id");
    return withLock(this.#dir, async () => {
      const entries = await readEntries(this.#path);
      const entry = findEntry(entries, id);
      const dispatchedAt = normalizeDate(options.dispatchedAt ?? new Date());
      entry.status = "dispatched";
      entry.dispatchedAt = dispatchedAt;
      entry.updatedAt = dispatchedAt;
      delete entry.lastError;
      await writeEntries(this.#dir, this.#path, entries);
      return cloneEntry(entry);
    });
  }

  /**
   * Records a dispatch failure without deleting the row. The attempt counter is
   * durable, and `availableAt` lets hosts add backoff without changing payloads.
   */
  async markFailed(
    id: string,
    error: unknown,
    options: { now?: string | Date; availableAt?: string | Date } = {},
  ): Promise<OutboxStoredEntry> {
    assertNonEmpty(id, "id");
    return withLock(this.#dir, async () => {
      const entries = await readEntries(this.#path);
      const entry = findEntry(entries, id);
      const now = normalizeDate(options.now ?? new Date());
      entry.status = "pending";
      entry.attempts += 1;
      entry.updatedAt = now;
      entry.availableAt = normalizeDate(options.availableAt ?? now);
      entry.lastError = errorMessage(error);
      await writeEntries(this.#dir, this.#path, entries);
      return cloneEntry(entry);
    });
  }
}

/**
 * Builds the initial durable row for a staged outbox payload, validating tenant
 * scope and payload minimization shape before the row can be committed.
 */
function createPendingEntry(input: OutboxEnqueueInput): OutboxStoredEntry {
  const tenantId = assertNonEmpty(input.tenantId, "tenantId");
  const id = assertNonEmpty(input.id, "id");
  validatePayload(input.payload, tenantId);
  const now = normalizeDate(new Date());
  return {
    id,
    tenantId,
    payload: clonePayload(input.payload),
    availableAt: normalizeDate(input.availableAt ?? now),
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Validates the public governed-change outbox payload contract without adding
 * new storage-only protocol semantics.
 */
function validatePayload(payload: OutboxPayload, expectedTenantId?: string): void {
  if (!isRecordObject(payload)) {
    throw new TypeError("outbox payload must be an object");
  }
  if (payload.schemaVersion !== OUTBOX_SCHEMA_VERSION) {
    throw new TypeError("outbox payload schemaVersion is unsupported");
  }
  if (
    payload.mutationBinding !== "same_transaction" &&
    payload.mutationBinding !== "not_transaction_bound" &&
    payload.mutationBinding !== "best_effort"
  ) {
    throw new TypeError("outbox payload mutationBinding is unsupported");
  }
  if (!Array.isArray(payload.records) || !Array.isArray(payload.edges)) {
    throw new TypeError("outbox payload records and edges are required");
  }
  assertPayloadTenantScope(payload, expectedTenantId);
}

/**
 * Requires every event and edge in a payload to carry the same tenant scope as
 * the committed outbox row so one tenant queue can never dispatch another
 * tenant's evidence.
 */
function assertPayloadTenantScope(payload: OutboxPayload, expectedTenantId?: string): void {
  let payloadTenantId = expectedTenantId;
  for (const record of payload.records) {
    payloadTenantId = assertPayloadItemTenant(record.scope?.tenantId, payloadTenantId);
  }
  for (const edge of payload.edges) {
    payloadTenantId = assertPayloadItemTenant(edge.scope?.tenantId, payloadTenantId);
  }
}

/**
 * Validates one event or edge tenant scope against the payload's expected tenant.
 */
function assertPayloadItemTenant(tenantId: unknown, expectedTenantId: string | undefined): string {
  const actualTenantId = assertNonEmpty(tenantId, "scope.tenantId");
  if (expectedTenantId !== undefined && actualTenantId !== expectedTenantId) {
    throw new TypeError("outbox payload tenant mismatch");
  }
  return actualTenantId;
}

/**
 * Parses and validates a serialized SQL outbox row from an untrusted driver
 * result before returning it to list or dispatcher callers.
 */
function entryFromSqlRow(row: Record<string, unknown>): OutboxStoredEntry {
  const parsed = JSON.parse(readString(row, "entry_json")) as unknown;
  validateStoredEntry(parsed);
  const entry = parsed as OutboxStoredEntry;
  const canonical = readString(row, "payload_canonical");
  if (canonicalJson(entry.payload) !== canonical) {
    throw new TypeError("stored outbox entry integrity check failed");
  }
  return cloneEntry(entry);
}

/**
 * Reads the full JSON outbox snapshot, treating a missing file as an empty
 * queue and validating rows before they enter dispatcher decisions.
 */
async function readEntries(path: string): Promise<OutboxStoredEntry[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new TypeError("outbox file is not a row array");
  }
  for (const entry of parsed) {
    validateStoredEntry(entry);
  }
  return parsed.map((entry) => cloneEntry(entry as OutboxStoredEntry)).sort(compareEntries);
}

/**
 * Writes an outbox snapshot through a temporary file and rename so readers never
 * observe a partially written JSON document.
 */
async function writeEntries(dir: string, path: string, entries: OutboxStoredEntry[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `entries.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(entries.sort(compareEntries), null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

/**
 * Serializes file outbox mutations so concurrent local dispatchers do not race
 * the JSON snapshot or lose retry counters.
 */
async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lockPath = join(dir, ".outbox.lock");
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

/**
 * Filters and bounds rows after validation so dispatch order is predictable and
 * tenant scopes cannot bleed into each other.
 */
function filterEntries(entries: OutboxStoredEntry[], options: OutboxListOptions): OutboxStoredEntry[] {
  let filtered = entries;
  if (options.tenantId !== undefined) {
    filtered = filtered.filter((entry) => entry.tenantId === options.tenantId);
  }
  filtered = filtered.sort(compareEntries);
  return options.limit === undefined ? filtered : filtered.slice(0, options.limit);
}

/**
 * Finds one mutable row in the loaded snapshot and fails closed when a dispatcher
 * references an unknown outbox ID.
 */
function findEntry(entries: OutboxStoredEntry[], id: string): OutboxStoredEntry {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new TypeError("outbox entry not found");
  }
  return entry;
}

/**
 * Checks stored rows loaded from disk before any retry or dispatch decision uses
 * them as protocol payloads.
 */
function validateStoredEntry(entry: unknown): void {
  if (!isRecordObject(entry)) {
    throw new TypeError("stored outbox entry is invalid");
  }
  assertNonEmpty(entry.id, "id");
  assertNonEmpty(entry.tenantId, "tenantId");
  validatePayload(entry.payload as OutboxPayload, String(entry.tenantId));
  if (entry.status !== "pending" && entry.status !== "dispatched") {
    throw new TypeError("stored outbox status is invalid");
  }
  const attempts = entry.attempts;
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0) {
    throw new TypeError("stored outbox attempts is invalid");
  }
  normalizeDate(entry.availableAt);
  normalizeDate(entry.createdAt);
  normalizeDate(entry.updatedAt);
  if (entry.dispatchedAt !== undefined) {
    normalizeDate(entry.dispatchedAt);
  }
}

/**
 * Normalizes common SQL driver result shapes into a row array.
 */
function rowsFromResult(result: SqlOutboxQueryResult): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) {
    if (result.length === 2 && Array.isArray(result[0])) {
      return result[0] as readonly Record<string, unknown>[];
    }
    return result as readonly Record<string, unknown>[];
  }
  return (result as { rows: readonly Record<string, unknown>[] }).rows;
}

/**
 * Returns the first SQL row from a normalized query result.
 */
function firstRow(result: SqlOutboxQueryResult): Record<string, unknown> | undefined {
  return rowsFromResult(result)[0];
}

/**
 * Reads a string field from a SQL row and rejects malformed driver results.
 */
function readString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new TypeError("stored outbox entry integrity check failed");
  }
  return value;
}

/**
 * Validates list controls before they influence tenant-scoped queue scans.
 */
function validateListOptions(options: OutboxListOptions): void {
  if (options.tenantId !== undefined) {
    assertNonEmpty(options.tenantId, "tenantId");
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new TypeError("limit must be a non-negative integer");
  }
  if (options.now !== undefined) {
    normalizeDate(options.now);
  }
}

/**
 * Compares only the fields that make enqueue idempotency safe. Timestamps and
 * retry metadata are intentionally ignored.
 */
function sameEnqueueInput(left: OutboxStoredEntry, right: OutboxStoredEntry): boolean {
  return left.tenantId === right.tenantId && canonicalJson(left.payload) === canonicalJson(right.payload);
}

/**
 * Keeps queue processing stable across process restarts.
 */
function compareEntries(left: OutboxStoredEntry, right: OutboxStoredEntry): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * Converts a Date-like input into an ISO string, rejecting invalid timestamps
 * before they can affect retry ordering.
 */
function normalizeDate(value: string | Date | unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("timestamp is invalid");
  }
  return date.toISOString();
}

/**
 * Extracts a stable failure message without persisting stack traces or arbitrary
 * thrown objects into the outbox metadata.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "outbox dispatch failed";
}

/**
 * Enforces non-empty string identifiers at the storage boundary.
 */
function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

/**
 * Narrows untrusted JSON values to object records before payload validation.
 */
function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Quotes an identifier or schema-qualified identifier after validating that no
 * caller-controlled SQL syntax can enter generated statements.
 */
function quoteTableName(tableName: string, dialect: SqlDialect): string {
  const parts = tableName.split(".");
  if (parts.length === 0 || parts.length > 2 || parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) {
    throw new TypeError("tableName must be an identifier or schema-qualified identifier");
  }

  return parts
    .map((part) => {
      return dialect === "postgres" ? `"${part}"` : `\`${part}\``;
    })
    .join(".");
}

/**
 * Clones outbox rows before returning them so callers cannot mutate staged or
 * stored evidence payloads by reference.
 */
function cloneEntry(entry: OutboxStoredEntry): OutboxStoredEntry {
  return JSON.parse(JSON.stringify(entry)) as OutboxStoredEntry;
}

/**
 * Clones minimized governed-change payloads before persistence.
 */
function clonePayload(payload: OutboxPayload): OutboxPayload {
  return JSON.parse(JSON.stringify(payload)) as OutboxPayload;
}

/**
 * Sleeps between lock attempts without introducing a runtime dependency.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
