# MySQL / MariaDB Storage Example

Reference skeleton for persisting Veritio audit records in MySQL-compatible
databases. It is not installed by the root workspace verification command.

The store factory receives a transaction-capable query boundary from the host
server and delegates to `@veritio/storage`. This directory contains no
connection strings or database credentials.

## Files

- `src/schema.sql` defines a minimal append-only table.
- `src/create-mysql-audit-store.ts` adapts host clients to `@veritio/storage`.
- `src/server-recorder.ts` shows recorder construction from an injected store.

## Local Use

```sh
bun install
bun run typecheck
```

Use database-level transactions around `append`. The example fails closed when
tenant scope is missing or an idempotency key is reused for a different event.

## External Conformance Check

For a real MySQL or MariaDB check, create a Bun integration test in the host app
or CI workspace that imports `createAuditStoreConformanceTests` from
`@veritio/storage/conformance`. Start a disposable database, apply
`src/schema.sql`, build storage, and inject a transaction-capable
`SqlAuditExecutor` into `createMySqlServerAuditStore` or
`createMariaDbServerAuditStore`.

```sh
bun run --cwd ../../storage build
bun test path/to/mysql.conformance.test.ts
```

Connection URLs and credentials belong in the host test bootstrap or CI secret
setup, not in `@veritio/storage`.
