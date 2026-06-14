# `@veritio/storage`

Host-injected storage helpers for Veritio audit trail evidence.

The package provides durable `AuditStore` factories for transaction-capable SQL
and MongoDB boundaries, plus a Redis tenant-tip cache helper. It does not read
environment variables, open database connections, or bundle vendor clients.

## Durable Stores

- `createPostgresAuditStore`: PostgreSQL-compatible stores.
- `createNeonAuditStore`: Neon-backed PostgreSQL-compatible stores.
- `createMysqlAuditStore`: MySQL-compatible stores.
- `createMariaDbAuditStore`: MariaDB-compatible stores.
- `createMongoAuditStore`: MongoDB stores with host-provided transaction
  boundaries.

Host applications must provide a transaction-capable client wrapper. The store
uses tenant-scoped append ordering, idempotency-key hashes, expected previous
hash checks, and persisted record integrity validation.

## Redis

`createRedisAuditTipCache` stores and reads validated tenant chain tips. It is
not an `AuditStore` and does not claim durable audit evidence on its own. Use it
alongside a durable store when a cache is useful.

## AuditStore Conformance Suite

`@veritio/storage/conformance` exports `createAuditStoreConformanceTests` for
adapter tests. Use it for in-memory fakes and for live database integration
checks so all durable stores prove the same behavior: tenant-scoped ordering,
idempotency conflicts, expected previous-hash checks, cloned returned records,
and fail-closed integrity validation.

```ts
import { describe, test } from "bun:test";
import { createPostgresAuditStore } from "@veritio/storage";
import { createAuditStoreConformanceTests } from "@veritio/storage/conformance";

describe("postgres live AuditStore conformance", () => {
  for (const conformanceTest of createAuditStoreConformanceTests({
    name: "postgres live",
    async createTarget() {
      const host = await createHostInjectedPostgresHarness();
      await host.resetAuditTable();

      return {
        store: createPostgresAuditStore({ client: host.executor }),
        async mutateStoredRecord({ tenantId, sequence, mutate }) {
          const record = await host.readRecordJson(tenantId, sequence);
          await host.writeRecordJson(tenantId, sequence, mutate(record) ?? record);
        },
        close: () => host.close(),
      };
    },
  })) {
    test(conformanceTest.name, conformanceTest.run);
  }
});
```

The host harness owns database clients, credentials, connection strings, test
containers, and cleanup. Keep environment-variable reads in the test bootstrap
or CI setup, not in `storage/src`.

## External DB Checks

External database checks run through the same package test command when matching
connection strings are present. Without these environment variables, the live
database suites are skipped and the in-memory conformance tests still run.

```sh
VERITIO_POSTGRES_TEST_URL=postgresql://... \
VERITIO_MYSQL_TEST_URL=mysql://... \
VERITIO_MONGODB_TEST_URL=mongodb://... \
bun run --cwd storage test
```

Supported live-test variables:

- `VERITIO_POSTGRES_TEST_URL`
- `VERITIO_NEON_TEST_URL`
- `VERITIO_MYSQL_TEST_URL`
- `VERITIO_MARIADB_TEST_URL`
- `VERITIO_MONGODB_TEST_URL`

The GitHub Actions verification job runs Postgres, MySQL, MariaDB, and MongoDB
service containers and sets these variables for `bun run verify`. The
`VERITIO_NEON_TEST_URL` job value points at the same Postgres-compatible service
so the Neon factory stays covered without requiring a hosted Neon account.
Projects that need hosted Neon proof can set `VERITIO_NEON_TEST_URL` to a
disposable branch connection string in their own CI.

For local runs:

1. Start a disposable Postgres, Neon branch, MySQL, MariaDB, or MongoDB test
   database outside this package.
2. For SQL stores, use the schema helpers or example schemas. For MongoDB,
   create indexes from `MONGO_AUDIT_RECORD_INDEXES`.
3. Run `bun run --cwd storage test` with the matching environment variables.

Redis is not a durable `AuditStore` target and should not run this conformance
suite. Test Redis only as a validated tenant-tip cache beside a durable store.

## SQL Schema Helpers

`POSTGRES_AUDIT_RECORDS_SCHEMA_SQL` and `MYSQL_AUDIT_RECORDS_SCHEMA_SQL`
provide starting table definitions. Review them for your database policy,
backup, retention, and migration requirements before applying them.

Veritio supports evidence collection and verification workflows. It is not legal
advice and does not make an application automatically compliant with any
regulation or framework.
