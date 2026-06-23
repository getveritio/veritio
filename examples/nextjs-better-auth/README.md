# Next.js + Better Auth Governed CRUD Reference

Runnable Next.js App Router reference using Better Auth and Veritio evidence
support. Run `bun run verify:examples` from the repo root to build and typecheck
it with the rest of the examples.

The example keeps tenant resolution, actor resolution, Better Auth hooks, and
the Veritio recorder in server-only modules. Browser forms never submit
`tenantId` or `actorUserId`.

## What It Shows

- `app/api/auth/[...all]/route.ts` mounts the Better Auth App Router handler.
- Better Auth `databaseHooks.user.create.after` maps user creation into a
  Veritio audit event through `src/veritio/auth-events.ts`.
- `app/actions/run-governed-crud.ts` runs create, archive, and delete project
  mutations from a server action.
- `app/actions/run-governed-lifecycle.ts` runs a broader helper-driven scenario:
  auth session with country/region context, organization bootstrap, membership,
  consent, data-subject request, export bundle, retention policy, and processor
  transfer graph evidence.
- `app/api/projects/route.ts` exposes the same CRUD mechanics through
  `POST`, `PUT`, and `DELETE` route handlers.
- `app/api/scenarios/governed-lifecycle/route.ts` exposes the lifecycle scenario
  for local HTTP smoke tests.
- Each project mutation records a Veritio audit event and a graph edge using
  shared protocol relations: `created`, `modified`, and `deleted`.
- `app/api/evidence/route.ts` returns audit records, graph edges, local project
  state, and verification results for both hash chains.

## Files

- `app/page.tsx` renders the server-action form and recent audit/graph evidence.
- `app/audit/page.tsx` renders the full tenant-scoped audit and graph trail.
- `app/actions/record-profile-update.ts` keeps the smaller profile-update event example.
- `app/actions/run-governed-crud.ts` runs the full CRUD sequence.
- `app/actions/run-governed-lifecycle.ts` runs the broader helper-driven
  lifecycle scenario.
- `app/api/auth/[...all]/route.ts` mounts Better Auth.
- `app/api/projects/route.ts` records governed project mutations through API routes.
- `app/api/scenarios/governed-lifecycle/route.ts` records the broader lifecycle scenario.
- `app/api/evidence/route.ts` returns the composed evidence trail.
- `src/veritio/server.ts` owns the recorder, in-memory stores, graph edge chain,
  and reference session boundary.
- `src/veritio/auth.ts` / `auth-events.ts` bridge Better Auth lifecycle hooks to Veritio.

## Run

```sh
cd examples/nextjs-better-auth
bun install
bun run typecheck
bun run build
bun run dev
```

Open `http://localhost:3000`, click **Run sequence**, then view `/audit`,
`/api/audit`, or `/api/evidence`.

API smoke:

```sh
curl -X POST http://localhost:3000/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","name":"Governed Project","requestId":"demo:create"}'
curl -X PUT http://localhost:3000/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","status":"archived","requestId":"demo:update"}'
curl -X DELETE http://localhost:3000/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","requestId":"demo:delete"}'
curl -X POST http://localhost:3000/api/scenarios/governed-lifecycle
curl http://localhost:3000/api/evidence
```

## Why It Works

Next route handlers and server actions are host boundaries. Veritio receives
already-resolved tenant and actor identity from those server boundaries, then
records deterministic, tenant-scoped audit and graph records. The sample is
zero-config and in-memory, so it works without hosted Veritio, a database, or
auth provider credentials.

Before production use, replace the reference session with a real Better Auth
session plus tenant or organization membership lookup, and replace the in-memory
stores with durable storage. The Better Auth `secret` and `baseURL` in
`src/veritio/auth.ts` are local reference values only.
