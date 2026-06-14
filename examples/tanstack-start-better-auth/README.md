# TanStack Start + Better Auth Example

Reference skeleton for TanStack Start with Better Auth and Veritio. It is not
installed by the root workspace verification command.

The recorder lives under `src/server`, and TanStack server routes are the only
place that read or list audit records. Host applications must provide tenant
scope from their own server-side auth/session boundary before recording events.

## Local Use

```sh
bun install
bun run typecheck
```

This example contains no storage connection configuration. Replace
`MemoryAuditStore` with an injected durable store at the server boundary.
