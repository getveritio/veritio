# SvelteKit + Better Auth Governed CRUD Example

Runnable SvelteKit reference with Better Auth, Veritio lifecycle events, and a
small governed CRUD API.

The recorder lives in `$lib/server`, which SvelteKit treats as server-only.
Routes call into that boundary to record and list tenant-scoped audit records.
Recording happens only on the server.

## What It Shows

- `src/hooks.server.ts` mounts Better Auth with `svelteKitHandler(...)`.
- Better Auth `databaseHooks.user.create.after` maps user creation into a
  Veritio audit event through `$lib/server/auth-events.ts`.
- `src/routes/api/projects/+server.ts` exposes `POST`, `PUT`, and `DELETE`
  handlers for create, archive, and delete project mutations.
- Each project mutation records a Veritio audit event and a graph edge using
  shared protocol relations: `created`, `modified`, and `deleted`.
- `src/routes/api/evidence/+server.ts` returns audit records, graph edges,
  in-memory project state, and verification results for both hash chains.
- `src/routes/api/scenarios/governed-lifecycle/+server.ts` runs a larger
  helper-driven lifecycle scenario with auth session, organization, membership,
  consent, data subject request, export bundle, retention, and processor-transfer
  evidence.
- The lifecycle scenario uses SDK templates, country/region security context,
  deterministic canonical JSON hashing, and ten graph edges across supported
  relations including `subject_of`, `processed_for`, `retained_under`,
  `exports`, `sent_to`, `attests_to`, and `part_of`.

## Files

- `src/routes/+page.svelte` runs the CRUD sequence and renders audit plus graph evidence.
- `src/hooks.server.ts` mounts Better Auth at the SvelteKit server boundary.
- `src/routes/api/projects/+server.ts` records governed project mutations.
- `src/routes/api/evidence/+server.ts` returns the composed evidence trail.
- `src/routes/api/scenarios/governed-lifecycle/+server.ts` records the larger
  helper-driven audit and activity-graph scenario.
- `src/routes/api/profile-updates/+server.ts` keeps the smaller profile-update event example.
- `src/lib/server/veritio.ts` owns the recorder, in-memory stores, graph edge
  chain, and reference session boundary.
- `src/lib/server/auth.ts` / `auth-events.ts` bridge Better Auth lifecycle hooks to Veritio.

## Run

```sh
cd examples/sveltekit-better-auth
bun install
bun run dev
```

Open `http://localhost:5173`, click **Run governed CRUD**, then inspect the
audit events and activity graph. Click **Run lifecycle graph** to add the
broader governed-system scenario.

API smoke:

```sh
curl -X POST http://localhost:5173/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","name":"Governed Project","requestId":"demo:create"}'
curl -X PUT http://localhost:5173/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","status":"archived","requestId":"demo:update"}'
curl -X DELETE http://localhost:5173/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","requestId":"demo:delete"}'
curl -X POST http://localhost:5173/api/scenarios/governed-lifecycle
curl http://localhost:5173/api/evidence
```

## Why It Works

SvelteKit route handlers provide the host boundary. The browser never submits
tenant or actor identifiers; the server resolves them before recording
deterministic audit and graph records. The example is zero-config and in-memory,
so it works without hosted Veritio, a database, or auth provider credentials.

Before production use, replace the reference session with a real Better Auth
session plus tenant or organization membership lookup, and replace the in-memory
stores with durable storage. The Better Auth `secret` and `baseURL` in
`src/lib/server/auth.ts` are local reference values only.
