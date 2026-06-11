# Next.js + Better Auth Reference

Runnable reference for a Next.js App Router project using Better Auth and
Veritio evidence support. It is not installed by the root workspace verification
command.

The example keeps tenant resolution, actor resolution, and the Veritio recorder
in server-only modules. Browser forms never submit `tenantId` or `actorUserId`.
Replace the reference session boundary and `MemoryAuditStore` before using this
shape beyond local development.

## Files

- `app/page.tsx` renders the reference form and recent audit records.
- `app/audit/page.tsx` renders the tenant-scoped audit trail.
- `app/actions/record-profile-update.ts` records a server-action event.
- `app/api/audit/route.ts` returns tenant-scoped records as JSON.
- `app/api/auth/[...all]/route.ts` mounts the Better Auth App Router handler.
- `src/veritio/server.ts` creates the server-only recorder and session boundary.
- `src/veritio/auth.ts` exposes a Better Auth factory and demo boundary.
- `src/veritio/auth-events.ts` maps Better Auth lifecycle events to Veritio.

## Local Use

```sh
cd examples/nextjs-better-auth
bun install
bun run typecheck
bun run build
bun run dev
```

Open `http://localhost:3000`, submit the profile form, then view `/audit` or
`/api/audit`.

This reference intentionally contains no database connection string, Better Auth
secret, email provider, OAuth provider, or hosted Veritio credential. Host apps
must provide:

- Better Auth storage and production auth options.
- A session lookup that resolves the signed-in Better Auth user.
- A tenant or organization membership lookup for that user.
- A durable Veritio `AuditStore` instead of `MemoryAuditStore`.

The hard-coded `tenant_demo` and `user_demo` values in
`src/veritio/server.ts` are server-side placeholders only. They are there to
make the reference runnable without credentials and must be replaced by the host
application boundary.
