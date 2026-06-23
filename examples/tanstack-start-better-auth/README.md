# TanStack Start + Better Auth Governed CRUD Example

Runnable TanStack Start reference using `@veritio/tanstack-start`, Better Auth,
and a local governed CRUD API. Run `bun run verify:examples` from the repo root
to build and typecheck it with the rest of the examples.

Recording happens only on the server. The browser calls route handlers under
`src/routes/api/`; tenant and actor identity are resolved by
`src/server/veritio.ts` and never read from browser input.

## What It Shows

- `src/routes/api/auth/$.ts` mounts Better Auth with `auth.handler(request)`.
- Better Auth `databaseHooks.user.create.after` maps user creation into a
  Veritio audit event through `src/server/auth-events.ts`.
- `src/routes/api/projects.ts` exposes `POST`, `PUT`, and `DELETE` handlers for
  create, archive, and delete project mutations.
- Each project mutation records a Veritio audit event and a graph edge using
  shared protocol relations: `created`, `modified`, and `deleted`.
- `src/routes/api/evidence.ts` returns audit records, graph edges, local project
  state, and verification results for both hash chains.
- `src/routes/api/scenarios/governed-lifecycle.ts` runs a larger helper-driven
  lifecycle scenario with auth session, organization, membership, consent, data
  subject request, export bundle, retention, and processor-transfer evidence.
- The lifecycle scenario uses SDK templates, country/region security context,
  deterministic canonical JSON hashing, and ten graph edges across supported
  relations including `subject_of`, `processed_for`, `retained_under`,
  `exports`, `sent_to`, `attests_to`, and `part_of`.

## Files

- `src/routes/index.tsx` runs the CRUD sequence and renders audit plus graph evidence.
- `src/routes/api/auth/$.ts` mounts Better Auth.
- `src/routes/api/projects.ts` records governed project mutations.
- `src/routes/api/evidence.ts` returns the composed evidence trail.
- `src/routes/api/scenarios/governed-lifecycle.ts` records the larger
  helper-driven audit and activity-graph scenario.
- `src/routes/api/profile-updates.ts` keeps the smaller profile-update event example.
- `src/server/veritio.ts` owns the recorder, adapter, in-memory stores, graph
  edge chain, and reference session boundary.
- `src/server/auth.ts` / `auth-events.ts` bridge Better Auth lifecycle hooks to Veritio.

## Run

```sh
cd examples/tanstack-start-better-auth
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

TanStack Start route handlers provide the host boundary. The example injects the
Veritio recorder and tenant resolver there, so framework routing does not become
part of the protocol. The in-memory stores make the sample runnable without
hosted Veritio, a database, or auth credentials.

Before production use, replace the reference session with a real Better Auth
session plus tenant or organization membership lookup, and replace the in-memory
stores with durable storage. The Better Auth `secret` and `baseURL` in
`src/server/auth.ts` are local reference values only.
