# Redis Tip Cache Example

Reference skeleton for using Redis with Veritio audit records. It is not
installed by the root workspace verification command.

The `@veritio/storage` Redis helper shown here is a validated tenant-tip cache.
It is not an `AuditStore` and should be used alongside a durable store such as
Postgres, Neon, MySQL, MariaDB, or MongoDB.

## Files

- `src/create-redis-tip-cache.ts` adapts a host-injected Redis client.
- `src/server-cache.ts` shows cache construction from the server boundary.

## Local Use

```sh
bun install
bun run typecheck
```

This example contains no Redis URL or credentials. Veritio supports evidence
workflows; it is not legal advice.
