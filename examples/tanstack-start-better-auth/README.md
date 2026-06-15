# TanStack Start + Better Auth Example

Runnable reference for a TanStack Start project using the `@veritio/tanstack-start`
adapter (mirroring how the Next.js example uses `@veritio/next`). It is not
installed by the root workspace verification command; run `bun run verify:examples`
from the repo root to typecheck and build it alongside the other examples.

Recording happens only on the server. The browser calls server route handlers
under `src/routes/api/`; tenant and actor identity are resolved by the
server-owned boundary in `src/server/veritio.ts` and never read from browser
input.

## Files

- `src/routes/index.tsx` — reference UI: record a profile update, then load the trail.
- `src/routes/api/profile-updates.ts` — `POST` route handler that records a
  `profile.updated` event through the `@veritio/tanstack-start` adapter.
- `src/routes/api/audit.ts` — `GET` route handler returning the tenant-scoped trail.
- `src/server/veritio.ts` — server-only recorder, adapter, and reference session boundary.
- `src/server/auth.ts` / `auth-events.ts` — reference Better Auth lifecycle bridge.
- `src/routes/__root.tsx`, `src/router.tsx`, `vite.config.ts` — TanStack Start toolchain.

## Run

```sh
cd examples/tanstack-start-better-auth
bun install
bun run dev
```

Open `http://localhost:5173`, click **Record profile update**, then **Load audit
trail** to see the recorded, hash-chained event. The audit endpoints are also
reachable directly:

```sh
curl -X POST http://localhost:5173/api/profile-updates \
  -H 'content-type: application/json' -d '{"profileId":"profile_demo"}'
curl http://localhost:5173/api/audit
```

This reference is zero-config: it contains no database connection string, Better
Auth secret, or hosted Veritio credential. The in-memory `MemoryAuditStore` and
the hard-coded `tenant_demo` / `user_demo` session in `src/server/veritio.ts` are
server-side placeholders only. Host apps must replace them with a durable
`AuditStore` and a real Better Auth session plus tenant/organization lookup.
