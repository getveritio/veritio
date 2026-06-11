import { describe, expect, test } from "bun:test";
import {
  MemoryAuditStore,
  createAuditEvent,
  type AuditRecord,
} from "@veritio/core";
import { createAuditStoreConformanceTests, type AuditStoreConformanceCorruption } from "../conformance";
import {
  MYSQL_AUDIT_RECORDS_SCHEMA_SQL,
  POSTGRES_AUDIT_RECORDS_SCHEMA_SQL,
  createMariaDbAuditStore,
  createMongoAuditStore,
  createMysqlAuditStore,
  createNeonAuditStore,
  createPostgresAuditStore,
  createRedisAuditTipCache,
  type MongoAuditCollection,
  type MongoAuditDocument,
  type RedisAuditTipClient,
  type SqlAuditExecutor,
  type SqlAuditRow,
} from "../index";

describe("SQL AuditStore adapters", () => {
  for (const [label, createStore] of [
    ["postgres", createPostgresAuditStore],
    ["neon", createNeonAuditStore],
    ["mysql", createMysqlAuditStore],
    ["mariadb", createMariaDbAuditStore],
  ] as const) {
    describe(`${label} AuditStore conformance`, () => {
      for (const conformanceTest of createAuditStoreConformanceTests({
        name: label,
        createTarget() {
          const client = createSqlClient();
          return {
            store: createStore({ client }),
            mutateStoredRecord(corruption) {
              mutateSqlStoredRecord(client, corruption);
            },
          };
        },
      })) {
        test(conformanceTest.name, conformanceTest.run);
      }
    });
  }

  test("SQL schema helpers declare tenant and idempotency constraints", () => {
    expect(POSTGRES_AUDIT_RECORDS_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS veritio_audit_records");
    expect(POSTGRES_AUDIT_RECORDS_SCHEMA_SQL).toContain("UNIQUE (tenant_id, idempotency_key_hash)");
    expect(MYSQL_AUDIT_RECORDS_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS `veritio_audit_records`");
    expect(MYSQL_AUDIT_RECORDS_SCHEMA_SQL).toContain("UNIQUE KEY");
  });
});

describe("Mongo AuditStore adapter", () => {
  describe("mongo AuditStore conformance", () => {
    for (const conformanceTest of createAuditStoreConformanceTests({
      name: "mongo",
      createTarget() {
        const collection = createMongoCollection();
        return {
          store: createMongoAuditStore({
            collection,
            transaction: async (run) => run({ collection }),
          }),
          mutateStoredRecord(corruption) {
            mutateMongoStoredRecord(collection, corruption);
          },
        };
      },
    })) {
      test(conformanceTest.name, conformanceTest.run);
    }
  });
});

describe("Redis audit tip cache", () => {
  test("stores validated chain tips without pretending to be an AuditStore", async () => {
    const redis = createRedisClient();
    const cache = createRedisAuditTipCache({ client: redis, keyPrefix: "test:veritio:tips" });
    const durableStore = new MemoryAuditStore();
    const record = await durableStore.append(makeEvent("evt_01", "org_123", { role: "viewer" }));

    expect("append" in cache).toBe(false);
    expect("list" in cache).toBe(false);

    await cache.setTenantTip(record);

    expect(await cache.getTenantTip("org_123")).toEqual(record);
    expect(redis.values.get("test:veritio:tips:org_123")).toBe(JSON.stringify(record));
  });

  test("Redis tip cache fails closed for missing tenant scope and corrupted records", async () => {
    const redis = createRedisClient();
    const cache = createRedisAuditTipCache({ client: redis });
    const durableStore = new MemoryAuditStore();
    const record = await durableStore.append(makeEvent("evt_01", "org_123", { role: "viewer" }));

    await expect(cache.setTenantTip({ ...record, event: { ...record.event, scope: undefined } })).rejects.toThrow(
      "scope.tenantId is required",
    );

    redis.values.set("veritio:audit-tip:org_123", JSON.stringify({ ...record, hash: "0".repeat(64) }));

    await expect(cache.getTenantTip("org_123")).rejects.toThrow("stored audit record integrity check failed");
  });
});

function makeEvent(id: string, tenantId: string, metadata: Record<string, unknown>) {
  return createAuditEvent({
    id,
    occurredAt: `2026-06-10T00:00:0${id.endsWith("1") ? "0" : "1"}.000Z`,
    actor: { type: "user", id: `usr_${tenantId}` },
    action: "org.member.invited",
    target: { type: "organization", id: tenantId },
    scope: { tenantId, environment: "test" },
    metadata,
  });
}

function mutateSqlStoredRecord(
  client: SqlAuditExecutor & { rows: SqlAuditRow[] },
  corruption: AuditStoreConformanceCorruption,
): void {
  const index = client.rows.findIndex(
    (row) => row.tenant_id === corruption.tenantId && row.sequence === corruption.sequence,
  );
  if (index === -1) {
    throw new TypeError("stored audit record not found");
  }
  const row = client.rows[index]!;
  const record = JSON.parse(row.record_json) as AuditRecord;
  const nextRecord = corruption.mutate(record) ?? record;
  client.rows[index] = { ...row, record_json: JSON.stringify(nextRecord) };
}

function mutateMongoStoredRecord(
  collection: MongoAuditCollection & { documents: MongoAuditDocument[] },
  corruption: AuditStoreConformanceCorruption,
): void {
  const index = collection.documents.findIndex(
    (document) => document.tenantId === corruption.tenantId && document.sequence === corruption.sequence,
  );
  if (index === -1) {
    throw new TypeError("stored audit record not found");
  }
  const document = collection.documents[index]!;
  const record = JSON.parse(document.recordJson) as AuditRecord;
  const nextRecord = corruption.mutate(record) ?? record;
  collection.documents[index] = { ...document, recordJson: JSON.stringify(nextRecord) };
}

function createSqlClient(): SqlAuditExecutor & { rows: SqlAuditRow[] } {
  const client: SqlAuditExecutor & { rows: SqlAuditRow[] } = {
    rows: [],
    async transaction(run) {
      return run(client);
    },
    async execute(statement, params) {
      const sql = statement.toLowerCase();
      if (sql.startsWith("select event_canonical")) {
        const [tenantId, idempotencyKeyHash] = params;
        return client.rows.filter(
          (row) => row.tenant_id === tenantId && row.idempotency_key_hash === idempotencyKeyHash,
        );
      }
      if (sql.startsWith("select record_json") && sql.includes("order by") && sql.includes("desc")) {
        const [tenantId] = params;
        return client.rows
          .filter((row) => row.tenant_id === tenantId)
          .sort((a, b) => b.sequence - a.sequence)
          .slice(0, 1);
      }
      if (sql.startsWith("insert into")) {
        const [tenantId, sequence, idempotencyKeyHash, eventCanonical, recordJson, hash, previousHash, appendedAt] =
          params;
        if (client.rows.some((row) => row.tenant_id === tenantId && row.idempotency_key_hash === idempotencyKeyHash)) {
          throw new TypeError("duplicate idempotency key");
        }
        if (client.rows.some((row) => row.tenant_id === tenantId && row.sequence === sequence)) {
          throw new TypeError("duplicate tenant sequence");
        }
        client.rows.push({
          tenant_id: String(tenantId),
          sequence: Number(sequence),
          idempotency_key_hash: String(idempotencyKeyHash),
          event_canonical: String(eventCanonical),
          record_json: String(recordJson),
          hash: String(hash),
          previous_hash: previousHash === null ? null : String(previousHash),
          appended_at: String(appendedAt),
        });
        return [];
      }
      if (sql.startsWith("select record_json") && sql.includes("order by") && sql.includes("asc")) {
        const [tenantId, afterSequence, limit] = params;
        const rows = client.rows
          .filter((row) => row.tenant_id === tenantId && row.sequence > Number(afterSequence))
          .sort((a, b) => a.sequence - b.sequence);
        return limit === undefined ? rows : rows.slice(0, Number(limit));
      }
      throw new TypeError(`unexpected SQL: ${statement}`);
    },
  };

  return client;
}

function createMongoCollection(): MongoAuditCollection & { documents: MongoAuditDocument[] } {
  return {
    documents: [],
    async findOne(filter, options = {}) {
      const matches = this.documents.filter((document) => matchesMongoFilter(document, filter));
      if (options.sort?.sequence === -1) {
        matches.sort((a, b) => b.sequence - a.sequence);
      }
      if (options.sort?.sequence === 1) {
        matches.sort((a, b) => a.sequence - b.sequence);
      }
      return matches[0] ?? null;
    },
    async insertOne(document) {
      if (
        this.documents.some(
          (existing) =>
            existing.tenantId === document.tenantId && existing.idempotencyKeyHash === document.idempotencyKeyHash,
        )
      ) {
        throw new TypeError("duplicate idempotency key");
      }
      if (
        this.documents.some(
          (existing) => existing.tenantId === document.tenantId && existing.sequence === document.sequence,
        )
      ) {
        throw new TypeError("duplicate tenant sequence");
      }
      this.documents.push({ ...document });
      return { acknowledged: true };
    },
    find(filter, options = {}) {
      let matches = this.documents.filter((document) => matchesMongoFilter(document, filter));
      if (options.sort?.sequence === 1) {
        matches = matches.sort((a, b) => a.sequence - b.sequence);
      }
      if (typeof options.limit === "number") {
        matches = matches.slice(0, options.limit);
      }
      return {
        async toArray() {
          return matches;
        },
      };
    },
  };
}

function matchesMongoFilter(document: MongoAuditDocument, filter: Record<string, unknown>): boolean {
  if (filter.tenantId !== undefined && document.tenantId !== filter.tenantId) {
    return false;
  }
  if (filter.idempotencyKeyHash !== undefined && document.idempotencyKeyHash !== filter.idempotencyKeyHash) {
    return false;
  }
  const sequence = filter.sequence as { $gt?: number } | undefined;
  if (sequence?.$gt !== undefined && document.sequence <= sequence.$gt) {
    return false;
  }
  return true;
}

function createRedisClient(): RedisAuditTipClient & { values: Map<string, string> } {
  return {
    values: new Map<string, string>(),
    async get(key) {
      return this.values.get(key) ?? null;
    },
    async set(key, value) {
      this.values.set(key, value);
    },
  };
}
