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

External database checks are intentionally not part of the default package test
because they require live services. To run one:

1. Start a disposable Postgres, Neon branch, MySQL, MariaDB, or MongoDB test
   database outside this package.
2. Apply the matching schema helper or example schema and, for MongoDB, create
   the indexes from `MONGO_AUDIT_RECORD_INDEXES`.
3. Build the package with `bun run --cwd storage build`.
4. Run an integration test that imports `createAuditStoreConformanceTests` from
   `@veritio/storage/conformance` and injects a transaction-capable host client.

Redis is not a durable `AuditStore` target and should not run this conformance
suite. Test Redis only as a validated tenant-tip cache beside a durable store.

## SQL Schema Helpers

`POSTGRES_AUDIT_RECORDS_SCHEMA_SQL` and `MYSQL_AUDIT_RECORDS_SCHEMA_SQL`
provide starting table definitions. Review them for your database policy,
backup, retention, and migration requirements before applying them.

Veritio supports evidence collection and verification workflows. It is not legal
advice and does not make an application automatically compliant with any
regulation or framework.
