# MongoDB Storage Example

Reference skeleton for persisting Veritio audit records in MongoDB. It is not
installed by the root workspace verification command.

The reusable store lives in `@veritio/storage`. This example shows the expected
host boundary: applications provide a Mongo collection plus a transaction
wrapper. It contains no connection strings or database credentials.

## Files

- `src/create-mongo-audit-store.ts` exposes a host-injected store factory.
- `src/server-recorder.ts` shows recorder construction from the injected store.
- `src/indexes.ts` exports the required collection indexes.

## Local Use

```sh
bun install
bun run typecheck
```

Use MongoDB transactions or an equivalent host-managed atomic write boundary for
append operations. Veritio supports evidence workflows; it is not legal advice.

## External Conformance Check

For a real MongoDB check, create a Bun integration test in the host app or CI
workspace that imports `createAuditStoreConformanceTests` from
`@veritio/storage/conformance`. Start a disposable transaction-capable MongoDB
database, create the indexes from `src/indexes.ts`, build storage, and inject a
host-managed collection plus transaction wrapper into `createMongoServerAuditStore`.

```sh
bun run --cwd ../../storage build
bun test path/to/mongodb.conformance.test.ts
```

Connection URLs and credentials belong in the host test bootstrap or CI secret
setup, not in `@veritio/storage`.
