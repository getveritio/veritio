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
