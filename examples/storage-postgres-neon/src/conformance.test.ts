import { describe, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { AuditRecord } from "@veritio/core";
import { type AuditStoreConformanceCorruption, createAuditStoreConformanceTests } from "@veritio/storage/conformance";
import pg, { type Pool as PgPool } from "pg";
import type { PostgresAuditExecutor } from "./create-postgres-audit-store";
import { createPostgresServerAuditStore } from "./create-postgres-audit-store";

const { Pool } = pg;

/**
 * Live AuditStore conformance for the example's Postgres wiring. This is the
 * gate every authoritative store must pass: gapless per-tenant sequences,
 * idempotency uniqueness, and fail-closed integrity on corrupted rows.
 *
 * Runs only when VERITIO_POSTGRES_TEST_URL is set so the DB-free example gate
 * stays green. Start the repo's storage containers and point at them:
 *
 *   bun run --cwd ../../storage db:up
 *   VERITIO_POSTGRES_TEST_URL=postgresql://veritio:veritio@127.0.0.1:54391/veritio bun test src
 */
const postgresUrl = process.env.VERITIO_POSTGRES_TEST_URL;

if (!postgresUrl) {
  test.skip("postgres AuditStore conformance (set VERITIO_POSTGRES_TEST_URL to run)", () => {});
} else {
  describe("postgres AuditStore conformance", () => {
    for (const conformanceTest of createAuditStoreConformanceTests({
      name: "example postgres",
      async createTarget() {
        // One throwaway table per target keeps conformance runs isolated from
        // any real veritio_audit_records data in the same database. The column
        // shape matches @veritio/storage's POSTGRES_AUDIT_RECORDS_SCHEMA_SQL.
        const tableName = `veritio_example_conformance_${randomUUID().replaceAll("-", "")}`;
        const pool: PgPool = new Pool({ connectionString: postgresUrl });
        await pool.query(`CREATE TABLE IF NOT EXISTS "${tableName}" (
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
        )`);

        return {
          store: createPostgresServerAuditStore({ client: createExecutor(pool), tableName }),
          /**
           * Corrupts one stored row in place so the suite can prove reads
           * fail closed instead of returning tampered records.
           */
          async mutateStoredRecord(corruption: AuditStoreConformanceCorruption) {
            const { rows } = await pool.query(
              `SELECT record_json FROM "${tableName}" WHERE tenant_id = $1 AND sequence = $2`,
              [corruption.tenantId, corruption.sequence],
            );
            const record = JSON.parse(String(rows[0]?.record_json ?? "{}")) as AuditRecord;
            const nextRecord = corruption.mutate(record) ?? record;
            await pool.query(`UPDATE "${tableName}" SET record_json = $1 WHERE tenant_id = $2 AND sequence = $3`, [
              JSON.stringify(nextRecord),
              corruption.tenantId,
              corruption.sequence,
            ]);
          },
          async close() {
            await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
            await pool.end();
          },
        };
      },
    })) {
      test(conformanceTest.name, conformanceTest.run);
    }
  });
}

/**
 * Adapts a pg pool to the SqlAuditExecutor contract, including the explicit
 * transaction the store uses for append-time chain-tip locking.
 */
function createExecutor(pool: PgPool): PostgresAuditExecutor {
  return {
    execute(statement, params) {
      return pool.query(statement, [...params]);
    },
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await run({
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
