# Next.js + Better Auth Example

Reference skeleton for a Next.js App Router project using Better Auth and
Veritio. It is not installed by the root workspace verification command.

The example keeps the recorder in server-only modules and uses the Better Auth
adapter from explicit server hooks. Replace `MemoryAuditStore` with a durable
server-side store before using this shape beyond local development.

## Files

- `src/veritio/server.ts` creates the server-only recorder.
- `src/veritio/auth.ts` exposes a Better Auth factory that requires a tenant
  resolver from the host app.
- `src/veritio/auth-events.ts` maps Better Auth lifecycle events to Veritio.
- `app/actions/record-profile-update.ts` records an application mutation from a
  server action.
- `app/api/audit/route.ts` lists tenant-scoped audit records from a server route.

## Local Use

```sh
bun install
bun run typecheck
```

This skeleton contains no database connection configuration. Provide Better Auth
storage and Veritio storage at the server boundary in your application.
