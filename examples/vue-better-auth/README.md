# Vue + Better Auth Example

Reference skeleton for a Vite Vue client with a server-side Better Auth and
Veritio boundary. It is not installed by the root workspace verification
command.

Browser code calls application API routes only. The recorder, Better Auth hook
bridge, and audit listing logic stay in `server/`.

## Local Use

```sh
bun install
bun run typecheck
```

This example contains no storage connection configuration. Replace
`MemoryAuditStore` with an injected durable store on the server.
