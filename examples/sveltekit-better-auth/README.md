# SvelteKit + Better Auth Example

Reference skeleton for SvelteKit with Better Auth and Veritio. It is not
installed by the root workspace verification command.

The recorder lives in `$lib/server`, which SvelteKit treats as server-only.
Routes call into that boundary to record and list tenant-scoped audit records.

## Local Use

```sh
bun install
bun run typecheck
```

This example contains no storage connection configuration. Replace
`MemoryAuditStore` with an injected durable store on the server.
