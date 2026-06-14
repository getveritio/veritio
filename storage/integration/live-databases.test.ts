import { describe, test } from "bun:test";
import { MongoClient, type Collection } from "mongodb";
import mysql, { type Pool as MySqlPool } from "mysql2/promise";
import pg, { type Pool as PgPool } from "pg";
import { type AuditRecord } from "@veritio/core";
import { createAuditStoreConformanceTests, type AuditStoreConformanceCorruption } from "../src/conformance";
import {
  MONGO_AUDIT_RECORD_INDEXES,
  createMariaDbAuditStore,
  createMongoAuditStore,
  createMysqlAuditStore,
  createNeonAuditStore,
  createPostgresAuditStore,
  type MongoAuditCollection,
  type MongoAuditDocument,
  type SqlAuditExecutor,
  type SqlAuditQueryResult,
} from "../src";

const { Pool } = pg;

type SqlDialect = "postgres" | "mysql";
type SqlStoreFactory = typeof createPostgresAuditStore;

const postgresUrl = process.env.VERITIO_POSTGRES_TEST_URL;
const neonUrl = process.env.VERITIO_NEON_TEST_URL;
const mysqlUrl = process.env.VERITIO_MYSQL_TEST_URL;
const mariaDbUrl = process.env.VERITIO_MARIADB_TEST_URL;
const mongoUrl = process.env.VERITIO_MONGODB_TEST_URL;

if (postgresUrl) {
  defineSqlLiveSuite("postgres", "postgres", postgresUrl, createPostgresAuditStore);
}

if (neonUrl) {
  defineSqlLiveSuite("neon", "postgres", neonUrl, createNeonAuditStore);
}

if (mysqlUrl) {
  defineSqlLiveSuite("mysql", "mysql", mysqlUrl, createMysqlAuditStore);
}

if (mariaDbUrl) {
  defineSqlLiveSuite("mariadb", "mysql", mariaDbUrl, createMariaDbAuditStore);
}

if (mongoUrl) {
  defineMongoLiveSuite(mongoUrl);
}

/**
 * Registers live SQL conformance tests against one ephemeral tenant-chain table.
 */
function defineSqlLiveSuite(
  label: string,
  dialect: SqlDialect,
  url: string,
  createStore: SqlStoreFactory,
): void {
  describe(`${label} live AuditStore conformance`, () => {
    for (const conformanceTest of createAuditStoreConformanceTests({
      name: `${label} live`,
      async createTarget() {
        const tableName = uniqueIdentifier(`veritio_${label}_audit_records`);
        const target =
          dialect === "postgres"
            ? await createPostgresTarget(url, tableName)
            : await createMySqlTarget(url, tableName);
        return {
          store: createStore({ client: target.executor, tableName }),
          /**
           * Delegates deliberate record corruption to the live database target.
           */
          mutateStoredRecord(corruption) {
            return target.mutateStoredRecord(corruption);
          },
          close: target.close,
        };
      },
    })) {
      test(conformanceTest.name, conformanceTest.run);
    }
  });
}

/**
 * Creates a Postgres live target with schema setup, corruption hooks, and cleanup
 * scoped to one generated table.
 */
async function createPostgresTarget(url: string, tableName: string) {
  const pool = new Pool({ connectionString: url });
  await waitForConnection(() => pool.query("SELECT 1"));
  await pool.query(createPostgresSchemaSql(tableName));
  const executor = createPostgresExecutor(pool);

  return {
    executor,
    async mutateStoredRecord(corruption: AuditStoreConformanceCorruption) {
      const { rows } = await pool.query(
        `SELECT record_json FROM ${quotePostgresIdentifier(tableName)} WHERE tenant_id = $1 AND sequence = $2`,
        [corruption.tenantId, corruption.sequence],
      );
      const record = JSON.parse(String(rows[0]?.record_json ?? "{}")) as AuditRecord;
      const nextRecord = corruption.mutate(record) ?? record;
      await pool.query(
        `UPDATE ${quotePostgresIdentifier(tableName)} SET record_json = $1 WHERE tenant_id = $2 AND sequence = $3`,
        [JSON.stringify(nextRecord), corruption.tenantId, corruption.sequence],
      );
    },
    async close() {
      await pool.query(`DROP TABLE IF EXISTS ${quotePostgresIdentifier(tableName)}`);
      await pool.end();
    },
  };
}

/**
 * Creates a MySQL or MariaDB live target with schema setup, corruption hooks, and
 * cleanup scoped to one generated table.
 */
async function createMySqlTarget(url: string, tableName: string) {
  const pool = mysql.createPool(url);
  await waitForConnection(() => pool.query("SELECT 1"));
  await pool.query(createMySqlSchemaSql(tableName));
  const executor = createMySqlExecutor(pool);

  return {
    executor,
    async mutateStoredRecord(corruption: AuditStoreConformanceCorruption) {
      const [rows] = await pool.execute(
        `SELECT record_json FROM ${quoteMySqlIdentifier(tableName)} WHERE tenant_id = ? AND sequence = ?`,
        [corruption.tenantId, corruption.sequence],
      );
      const [row] = rows as Array<{ record_json: string }>;
      const record = JSON.parse(row?.record_json ?? "{}") as AuditRecord;
      const nextRecord = corruption.mutate(record) ?? record;
      await pool.execute(
        `UPDATE ${quoteMySqlIdentifier(tableName)} SET record_json = ? WHERE tenant_id = ? AND sequence = ?`,
        [JSON.stringify(nextRecord), corruption.tenantId, corruption.sequence],
      );
    },
    async close() {
      await pool.query(`DROP TABLE IF EXISTS ${quoteMySqlIdentifier(tableName)}`);
      await pool.end();
    },
  };
}

/**
 * Adapts a pg pool to the SqlAuditExecutor contract with explicit transactions.
 */
function createPostgresExecutor(pool: PgPool): SqlAuditExecutor {
  return {
    /**
     * Executes a single Postgres statement through the shared pool.
     */
    execute(statement, params) {
      return pool.query(statement, [...params]);
    },
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await run({
          /**
           * Executes a Postgres statement inside the open transaction.
           */
          execute(statement, params) {
            return client.query(statement, [...params]);
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Adapts a mysql2 pool to the SqlAuditExecutor contract with explicit
 * connection-scoped transactions.
 */
function createMySqlExecutor(pool: MySqlPool): SqlAuditExecutor {
  return {
    async execute(statement, params) {
      const [rows] = await pool.execute(statement, [...params]);
      return normalizeMySqlRows(rows);
    },
    async transaction(run) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await run({
          async execute(statement, params) {
            const [rows] = await connection.execute(statement, [...params]);
            return normalizeMySqlRows(rows);
          },
        });
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

/**
 * Registers live Mongo conformance tests against one ephemeral collection.
 */
function defineMongoLiveSuite(url: string): void {
  describe("mongodb live AuditStore conformance", () => {
    for (const conformanceTest of createAuditStoreConformanceTests({
      name: "mongodb live",
      async createTarget() {
        const collectionName = uniqueIdentifier("veritio_mongo_audit_records");
        const client = new MongoClient(url);
        await client.connect();
        const collection = client.db().collection<MongoAuditDocument>(collectionName);
        for (const index of MONGO_AUDIT_RECORD_INDEXES) {
          await collection.createIndex(index.keys, index.options);
        }

        return {
          store: createMongoAuditStore({
            collection: collection as unknown as MongoAuditCollection,
            transaction: async (run) =>
              client.withSession((session) =>
                session.withTransaction(async () =>
                  run({
                    collection: collection as unknown as MongoAuditCollection,
                    options: { session },
                  }),
                ),
              ),
          }),
          async mutateStoredRecord(corruption) {
            await mutateMongoStoredRecord(collection, corruption);
          },
          async close() {
            await collection.drop().catch(ignoreNamespaceMissing);
            await client.close();
          },
        };
      },
    })) {
      test(conformanceTest.name, conformanceTest.run);
    }
  });
}

/**
 * Mutates stored Mongo record JSON to prove the adapter fails closed on
 * integrity corruption.
 */
async function mutateMongoStoredRecord(
  collection: Collection<MongoAuditDocument>,
  corruption: AuditStoreConformanceCorruption,
): Promise<void> {
  const document = await collection.findOne({
    tenantId: corruption.tenantId,
    sequence: corruption.sequence,
  });
  const record = JSON.parse(document?.recordJson ?? "{}") as AuditRecord;
  const nextRecord = corruption.mutate(record) ?? record;
  await collection.updateOne(
    { tenantId: corruption.tenantId, sequence: corruption.sequence },
    { $set: { recordJson: JSON.stringify(nextRecord) } },
  );
}

/**
 * Builds the Postgres schema used only by live conformance tests.
 */
function createPostgresSchemaSql(tableName: string): string {
  const table = quotePostgresIdentifier(tableName);
  return `CREATE TABLE IF NOT EXISTS ${table} (
    tenant_id text NOT NULL,
    sequence bigint NOT NULL,
    idempotency_key_hash char(64) NOT NULL,
    event_canonical text NOT NULL,
    record_json text NOT NULL,
    hash char(64) NOT NULL,
    previous_hash char(64),
    appended_at text NOT NULL,
    PRIMARY KEY (tenant_id, sequence),
    UNIQUE (tenant_id, idempotency_key_hash)
  )`;
}

/**
 * Builds the MySQL/MariaDB schema used only by live conformance tests.
 */
function createMySqlSchemaSql(tableName: string): string {
  const table = quoteMySqlIdentifier(tableName);
  return `CREATE TABLE IF NOT EXISTS ${table} (
    tenant_id varchar(255) NOT NULL,
    sequence bigint NOT NULL,
    idempotency_key_hash char(64) NOT NULL,
    event_canonical longtext NOT NULL,
    record_json longtext NOT NULL,
    hash char(64) NOT NULL,
    previous_hash char(64),
    appended_at varchar(40) NOT NULL,
    PRIMARY KEY (tenant_id, sequence),
    UNIQUE KEY veritio_idempotency_unique (tenant_id, idempotency_key_hash),
    KEY veritio_tenant_sequence_idx (tenant_id, sequence)
  )`;
}

/**
 * Normalizes mysql2 result tuples into the row shape expected by storage tests.
 */
function normalizeMySqlRows(rows: unknown): SqlAuditQueryResult {
  return Array.isArray(rows) ? (rows as readonly Record<string, unknown>[]) : [];
}

/**
 * Retries initial database connectivity so container startup delay does not make
 * live tests flaky.
 */
async function waitForConnection(run: () => Promise<unknown>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await run();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError;
}

/**
 * Generates an isolated SQL table or Mongo collection name for one test target.
 */
function uniqueIdentifier(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

/**
 * Quotes a validated Postgres identifier for live-test SQL.
 */
function quotePostgresIdentifier(identifier: string): string {
  assertIdentifier(identifier);
  return `"${identifier}"`;
}

/**
 * Quotes a validated MySQL identifier for live-test SQL.
 */
function quoteMySqlIdentifier(identifier: string): string {
  assertIdentifier(identifier);
  return `\`${identifier}\``;
}

/**
 * Rejects unsafe SQL identifier text before quote helpers interpolate it.
 */
function assertIdentifier(identifier: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new TypeError("identifier must be a SQL identifier");
  }
}

/**
 * Ignores Mongo cleanup races where the ephemeral collection was already absent.
 */
function ignoreNamespaceMissing(error: unknown): void {
  if (typeof error === "object" && error !== null && "codeName" in error && error.codeName === "NamespaceNotFound") {
    return;
  }
  throw error;
}
