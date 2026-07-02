import { type AuditRecord, canonicalJson, hashAuditRecord } from "@veritio/core";

/**
 * Minimal ClickHouse HTTP-interface contract the read model needs from a
 * host-injected executor. `sql` may reference `{name:String}` placeholders
 * that the host binds via ClickHouse query parameters (`param_<name>` on the
 * HTTP interface) so tenant/episode/subject values are never interpolated
 * into SQL text. `body` carries JSONEachRow data for INSERTs. The host owns
 * the endpoint, credentials, database selection, and retries.
 */
export interface ClickHouseExecutor {
  execute(sql: string, options?: { params?: Record<string, string>; body?: string }): Promise<string>;
}

export interface ClickHouseAuditReadModelOptions {
  client: ClickHouseExecutor;
  tableName?: string;
}

/** Per-episode grouping summary for risk-rollup and session views. */
export interface ClickHouseEpisodeSummary {
  activityEpisodeId: string;
  stepCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
}

/**
 * Derived, eventually-consistent analytical read model for audit records on
 * ClickHouse. This is NOT an `AuditStore` and must never be authoritative:
 * ClickHouse has no synchronous unique constraints or transactional tip
 * checks, so gapless sequencing, idempotency conflicts, and verify/export
 * stay on a conforming authoritative store. This tier only accelerates
 * scan-heavy groupings (activity-episode rollups, session reconstruction,
 * subject scans) that would otherwise page whole tenant chains into memory.
 *
 * Projection is at-least-once: duplicate projections of the same record are
 * collapsed by the ReplacingMergeTree engine, and the read helpers query with
 * FINAL so replays never double-count. Every projected and returned record is
 * hash-revalidated, and the full canonical record travels as an opaque string
 * column so ClickHouse's typed columns can never rewrite the hashed bytes.
 */
export interface ClickHouseAuditReadModel {
  ensureSchema(): Promise<void>;
  project(records: readonly AuditRecord[]): Promise<number>;
  listEpisodes(tenantId: string): Promise<ClickHouseEpisodeSummary[]>;
  listEpisodeSteps(tenantId: string, activityEpisodeId: string): Promise<AuditRecord[]>;
  listBySubject(tenantId: string, subjectId: string): Promise<AuditRecord[]>;
}

const DEFAULT_CLICKHOUSE_TABLE = "veritio_audit_read_model";

/**
 * Builds the read-model DDL for a given table name. Envelope and grouping
 * keys are typed columns for pruning/aggregation; `record_json` keeps the
 * exact canonical record bytes as a raw String (never ClickHouse's native
 * JSON type, which parses and re-serializes and would break hash recompute).
 */
export function clickHouseAuditReadModelSchemaSql(tableName: string = DEFAULT_CLICKHOUSE_TABLE): string {
  return `CREATE TABLE IF NOT EXISTS ${quoteClickHouseIdentifier(tableName)} (
  tenant_id String,
  sequence UInt64,
  event_id String,
  occurred_at String,
  action LowCardinality(String),
  actor_type LowCardinality(String),
  actor_id String,
  target_type LowCardinality(String),
  target_id String,
  session_id String,
  activity_episode_id String,
  subject_id String,
  record_json String
) ENGINE = ReplacingMergeTree
ORDER BY (tenant_id, sequence)`;
}

/**
 * Creates the ClickHouse read model over an injected HTTP executor. All value
 * filters go through ClickHouse query parameters, never SQL interpolation.
 */
export function createClickHouseAuditReadModel(options: ClickHouseAuditReadModelOptions): ClickHouseAuditReadModel {
  const client = options.client;
  const table = quoteClickHouseIdentifier(options.tableName ?? DEFAULT_CLICKHOUSE_TABLE);

  /** Runs a parameterized SELECT and parses its JSONEachRow response lines. */
  async function queryRows(sql: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
    const response = await client.execute(sql, { params });
    return response
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /** Parses `record_json` rows back into hash-revalidated audit records. */
  function recordsFromRows(rows: readonly Record<string, unknown>[]): AuditRecord[] {
    return rows.map((row) => parseReadModelRecord(row.record_json));
  }

  return {
    async ensureSchema() {
      await client.execute(clickHouseAuditReadModelSchemaSql(options.tableName ?? DEFAULT_CLICKHOUSE_TABLE));
    },

    async project(records) {
      if (records.length === 0) {
        return 0;
      }
      const lines = records.map((record) => {
        if (hashAuditRecord(record) !== record.hash) {
          throw new TypeError("audit record integrity check failed");
        }
        const tenantId = record.event.scope?.tenantId;
        if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
          throw new TypeError("scope.tenantId is required");
        }
        const metadata = (record.event.metadata ?? {}) as Record<string, unknown>;
        return JSON.stringify({
          tenant_id: tenantId,
          sequence: record.sequence,
          event_id: record.event.id,
          occurred_at: record.event.occurredAt,
          action: record.event.action,
          actor_type: record.event.actor.type,
          actor_id: record.event.actor.id,
          target_type: record.event.target.type,
          target_id: record.event.target.id,
          session_id: metadataString(metadata.sessionId),
          activity_episode_id: metadataString(metadata.activityEpisodeId),
          subject_id: metadataString(metadata.subjectId),
          record_json: canonicalJson(record),
        });
      });
      await client.execute(`INSERT INTO ${table} FORMAT JSONEachRow`, { body: `${lines.join("\n")}\n` });
      return records.length;
    },

    async listEpisodes(tenantId) {
      requireNonEmpty(tenantId, "tenantId");
      const rows = await queryRows(
        `SELECT activity_episode_id, count() AS step_count, min(occurred_at) AS first_occurred_at, max(occurred_at) AS last_occurred_at
         FROM ${table} FINAL
         WHERE tenant_id = {tenantId:String} AND activity_episode_id != ''
         GROUP BY activity_episode_id
         ORDER BY first_occurred_at, activity_episode_id
         FORMAT JSONEachRow`,
        { tenantId },
      );
      return rows.map((row) => ({
        activityEpisodeId: String(row.activity_episode_id ?? ""),
        stepCount: Number(row.step_count ?? 0),
        firstOccurredAt: String(row.first_occurred_at ?? ""),
        lastOccurredAt: String(row.last_occurred_at ?? ""),
      }));
    },

    async listEpisodeSteps(tenantId, activityEpisodeId) {
      requireNonEmpty(tenantId, "tenantId");
      requireNonEmpty(activityEpisodeId, "activityEpisodeId");
      const rows = await queryRows(
        `SELECT record_json FROM ${table} FINAL
         WHERE tenant_id = {tenantId:String} AND activity_episode_id = {activityEpisodeId:String}
         ORDER BY occurred_at, sequence
         FORMAT JSONEachRow`,
        { tenantId, activityEpisodeId },
      );
      return recordsFromRows(rows);
    },

    async listBySubject(tenantId, subjectId) {
      requireNonEmpty(tenantId, "tenantId");
      requireNonEmpty(subjectId, "subjectId");
      const rows = await queryRows(
        `SELECT record_json FROM ${table} FINAL
         WHERE tenant_id = {tenantId:String} AND subject_id = {subjectId:String}
         ORDER BY sequence
         FORMAT JSONEachRow`,
        { tenantId, subjectId },
      );
      return recordsFromRows(rows);
    },
  };
}

/** Normalizes an optional metadata grouping key to a string column value ('' when absent). */
function metadataString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Parses one stored `record_json` value and fails closed unless its hash still recomputes. */
function parseReadModelRecord(value: unknown): AuditRecord {
  if (typeof value !== "string") {
    throw new TypeError("read-model audit record integrity check failed");
  }
  let record: AuditRecord;
  try {
    record = JSON.parse(value) as AuditRecord;
  } catch {
    throw new TypeError("read-model audit record integrity check failed");
  }
  if (hashAuditRecord(record) !== record.hash) {
    throw new TypeError("read-model audit record integrity check failed");
  }
  return record;
}

/** Restricts table names to safe identifiers and backtick-quotes them for ClickHouse SQL. */
function quoteClickHouseIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new TypeError("tableName must be a simple identifier");
  }
  return `\`${identifier}\``;
}

/** Rejects blank required string arguments with the argument name only (no values) in the error. */
function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} is required`);
  }
}
