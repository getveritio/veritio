# React + Better Auth Governed CRUD Example

Runnable Vite React reference with an Express server that mounts Better Auth,
records Veritio lifecycle events, and exposes a small governed CRUD API.

The browser calls same-origin API routes only. Tenant identity, actor identity,
Better Auth hooks, audit recording, graph-edge recording, and verification all
stay in `server/`.

## What It Shows

- `GET/POST /api/auth/*splat` is mounted with Better Auth before `express.json()`
  so Better Auth owns auth request parsing.
- Better Auth `databaseHooks.user.create.after` maps user creation into a
  Veritio audit event through `server/auth-events.ts`.
- `POST`, `PUT`, and `DELETE /api/projects` create a local project, archive it,
  then delete it while recording `project.created`, `project.updated`, and
  `project.deleted`.
- Each project mutation also appends a Veritio evidence-graph edge with
  `created`, `modified`, or `deleted`.
- `POST /api/scenarios/governed-lifecycle` records a broader helper-driven flow:
  auth session with country/region context, organization bootstrap, membership,
  consent, data-subject request, export bundle, retention policy, and processor
  transfer graph evidence.
- `GET /api/evidence` returns audit records, graph edges, in-memory project
  state, and independent verification results for both hash chains.

## Files

- `server/index.ts` mounts Better Auth and the project/evidence API routes.
- `server/auth.ts` creates the Better Auth instance and reference tenant boundary.
- `server/auth-events.ts` maps Better Auth lifecycle hooks to Veritio events.
- `server/veritio.ts` owns the recorder, in-memory store, graph edge chain, and
  server-resolved `tenant_demo` / `user_demo` session.
- `src/App.tsx` runs the CRUD sequence and renders audit plus graph evidence.

## Run

```sh
cd examples/react-better-auth
bun install

# Terminal 1: Express server on http://localhost:3001
bun run dev:server

# Terminal 2: Vite client on http://localhost:5173
bun run dev
```

Open `http://localhost:5173`, click **Run governed CRUD**, then inspect the
audit events and activity graph.

API smoke:

```sh
curl -X POST http://localhost:3001/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","name":"Governed Project","requestId":"demo:create"}'
curl -X PUT http://localhost:3001/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","status":"archived","requestId":"demo:update"}'
curl -X DELETE http://localhost:3001/api/projects \
  -H 'content-type: application/json' \
  -d '{"projectId":"project_demo","requestId":"demo:delete"}'
curl -X POST http://localhost:3001/api/scenarios/governed-lifecycle
curl http://localhost:3001/api/evidence
```

The lifecycle endpoint uses SDK templates such as `authSessionCreatedTemplate`,
`organizationCreatedTemplate`, `consentGrantedTemplate`,
`dataSubjectRequestCreatedTemplate`, `exportBundleCreatedTemplate`, and
`retentionPolicyAppliedTemplate`, plus `canonicalJson` for a deterministic
scenario hash.

## Why It Works

Veritio is injected at the host boundary. The React app never submits tenant or
actor identifiers; Express resolves them and records deterministic, tenant-scoped
audit and graph records. The example is zero-config and in-memory, so it works
without hosted Veritio, a database, or auth provider credentials.

Before production use, replace the reference session with a real Better Auth
session plus tenant or organization membership lookup, and replace the in-memory
stores with durable storage. The Better Auth `secret` and `baseURL` in
`server/auth.ts` are local reference values only.
