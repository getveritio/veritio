# SvelteKit + Better Auth Example

Reference skeleton for SvelteKit with Better Auth and Veritio. It is not
installed by the root workspace verification command.

The recorder lives in `$lib/server`, which SvelteKit treats as server-only.
Routes call into that boundary to record and list tenant-scoped audit records.
Recording happens only on the server.

## Run

SvelteKit serves the UI and the API routes from a single process.

```sh
cd examples/sveltekit-better-auth
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

This example is zero-config (in-memory `MemoryAuditStore`, hard-coded
`tenant_demo` / `user_demo`). It contains no storage connection configuration.
Replace `MemoryAuditStore` and the reference session with a durable store and a
real Better Auth session on the server before production use.
