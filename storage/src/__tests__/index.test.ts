import { describe, expect, test } from "bun:test";
import {
  MemoryAuditStore,
  canonicalJson,
  createAuditEvent,
  hashAuditRecord,
  verifyAuditRecords,
  type AuditRecord,
} from "@veritio/core";
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
    test(`${label} appends tenant chains and lists records deterministically`, async () => {
      const client = createSqlClient();
      const store = createStore({ client });

      const first = await store.append(makeEvent("evt_01", "org_123", { role: "viewer" }));
      const second = await store.append(makeEvent("evt_02", "org_123", { policy: "security_1y" }), {
        expectedPreviousHash: first.hash,
      });
      const otherTenant = await store.append(makeEvent("evt_03", "org_456", { role: "admin" }));

      expect(first.sequence).toBe(1);
      expect(second.sequence).toBe(2);
      expect(second.previousHash).toBe(first.hash);
      expect(otherTenant.sequence).toBe(1);

      const listed = await store.list({ tenantId: "org_123" });
      expect(listed).toEqual([first, second]);
      expect(verifyAuditRecords(listed)).toEqual({ ok: true });
      expect(await store.list({ tenantId: "org_123" }, { afterSequence: 1, limit: 1 })).toEqual([second]);
    });
  }

  test("SQL stores return idempotent records and reject idempotency conflicts", async () => {
    const client = createSqlClient();
    const store = createPostgresAuditStore({ client });
    const event = makeEvent("evt_01", "org_123", { role: "viewer" });

    const first = await store.append(event, { idempotencyKey: "invite:usr_456" });
    const repeated = await store.append(event, { idempotencyKey: "invite:usr_456" });

    expect(repeated).toEqual(first);
    expect(client.rows).toHaveLength(1);

    await expect(
      store.append(makeEvent("evt_02", "org_123", { role: "admin" }), { idempotencyKey: "invite:usr_456" }),
    ).rejects.toThrow("idempotency conflict");
  });

  test("SQL stores fail closed when tenant scope or stored integrity is missing", async () => {
    const client = createSqlClient();
    const store = createPostgresAuditStore({ client });

    await expect(store.append(makeEventWithoutTenant("evt_missing_scope"))).rejects.toThrow("scope.tenantId is required");

    await store.append(makeEvent("evt_01", "org_123", { role: "viewer" }));
    const corrupted = JSON.parse(client.rows[0]?.record_json ?? "{}") as AuditRecord;
    corrupted.hash = "0".repeat(64);
    client.rows[0] = { ...client.rows[0]!, record_json: JSON.stringify(corrupted) };

    await expect(store.list({ tenantId: "org_123" })).rejects.toThrow("stored audit record integrity check failed");
  });

  test("SQL schema helpers declare tenant and idempotency constraints", () => {
    expect(POSTGRES_AUDIT_RECORDS_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS veritio_audit_records");
    expect(POSTGRES_AUDIT_RECORDS_SCHEMA_SQL).toContain("UNIQUE (tenant_id, idempotency_key_hash)");
    expect(MYSQL_AUDIT_RECORDS_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS `veritio_audit_records`");
    expect(MYSQL_AUDIT_RECORDS_SCHEMA_SQL).toContain("UNIQUE KEY");
  });
});

describe("Mongo AuditStore adapter", () => {
  test("appends records through host-injected transactional collection access", async () => {
    const collection = createMongoCollection();
    const store = createMongoAuditStore({
      collection,
      transaction: async (run) => run({ collection }),
    });

    const first = await store.append(makeEvent("evt_01", "org_123", { role: "viewer" }));
    const second = await store.append(makeEvent("evt_02", "org_123", { policy: "security_1y" }), {
      expectedPreviousHash: first.hash,
    });

    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.hash);
    expect(await store.list({ tenantId: "org_123" })).toEqual([first, second]);
    expect(verifyAuditRecords(await store.list({ tenantId: "org_123" }))).toEqual({ ok: true });
  });

  test("rejects Mongo idempotency conflicts and corrupted stored records", async () => {
    const collection = createMongoCollection();
    const store = createMongoAuditStore({
      collection,
      transaction: async (run) => run({ collection }),
    });

    await store.append(makeEvent("evt_01", "org_123", { role: "viewer" }), { idempotencyKey: "same-key" });
    await expect(
      store.append(makeEvent("evt_02", "org_123", { role: "admin" }), { idempotencyKey: "same-key" }),
    ).rejects.toThrow("idempotency conflict");

    const corrupted = JSON.parse(collection.documents[0]?.recordJson ?? "{}") as AuditRecord;
    corrupted.event.scope = undefined;
    collection.documents[0] = { ...collection.documents[0]!, recordJson: JSON.stringify(corrupted) };

    await expect(store.list({ tenantId: "org_123" })).rejects.toThrow("scope.tenantId is required");
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

function makeEventWithoutTenant(id: string) {
  return createAuditEvent({
    id,
    occurredAt: "2026-06-10T00:00:00.000Z",
    actor: { type: "user", id: "usr_123" },
    action: "org.member.invited",
    target: { type: "organization", id: "org_123" },
    metadata: {},
  });
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
      if (this.documents.some((existing) => existing.tenantId === document.tenantId && existing.sequence === document.sequence)) {
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
