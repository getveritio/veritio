# Postgres / Neon Storage Example

Reference skeleton for persisting Veritio audit records in Postgres-compatible
databases, including Neon. It is not installed by the root workspace
verification command.

The store factory receives a transaction-capable query boundary from the host
server and delegates to `@veritio/storage`. This directory contains no
connection strings or database credentials.

## Files

- `src/schema.sql` defines a minimal append-only table.
- `src/create-postgres-audit-store.ts` adapts host clients to `@veritio/storage`.
- `src/server-recorder.ts` shows recorder construction from an injected store.
- `src/conformance.test.ts` runs the full `@veritio/storage/conformance` suite
  against this wiring when a live database URL is provided.

## Local Use

```sh
bun install
bun run typecheck
bun test src        # conformance skips without a live database URL
```

Use database-level transactions around `append`. The example fails closed when
tenant scope is missing or an idempotency key is reused for a different event.

## Live Conformance Check

`src/conformance.test.ts` imports `createAuditStoreConformanceTests` and proves
this example's store wiring satisfies the authoritative-store contract: gapless
per-tenant sequences, idempotency uniqueness, and fail-closed integrity when a
stored row is corrupted. Each run uses a throwaway table and drops it afterward.

```sh
bun run --cwd ../../storage db:up
VERITIO_POSTGRES_TEST_URL=postgresql://veritio:veritio@127.0.0.1:54391/veritio bun test src
bun run --cwd ../../storage db:down
```

Point `VERITIO_POSTGRES_TEST_URL` at a disposable Neon branch to run the same
suite through `createNeonServerAuditStore`. Connection URLs and credentials
belong in the host test bootstrap or CI secret setup, not in `@veritio/storage`.
