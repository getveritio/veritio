# React + Better Auth Governed-Change Example

Runnable Vite + React SPA backed by an Express server. A real UI action — edit an
entry, run the cost agent, or roll back — becomes a governed **Change**: it is
captured through the SDK's `createGovernedChangeDraft`, staged in a transactional
outbox, and dispatched server-to-server to the hosted Veritio Cloud, where it
appears live under **Evidence → Changes**.

The browser only ever calls same-origin `/api/governed/*` routes. Tenant scope,
actor identity, the HMAC digest key, and the hosted ingest token all stay on the
Express server. The browser never sees the token.

## What It Shows

- `GET /api/governed/snapshot` returns the current governed entities, the recent
  change feed, and a **browser-safe** cloud config (configured/base URL/project
  id only — never the ingest token).
- `POST /api/governed/action` runs one governed action (`create`, `update`,
  `agent_recalc`, `rollback`). The body is validated and fails closed before it
  can affect an entry id, actor id, or rollback target.
- Each action resolves before/after rows, builds a governed-change draft with
  `createGovernedChangeDraft`, applies the local mutation AND enqueues the
  evidence draft in one transactional-outbox step, then dispatches the outbox.
- Every revision carries a monotonic `version` field, so even a rollback that
  restores prior business values is a genuinely new revision with a distinct
  state digest — the entity is versioned, like a real system.
- `customerEmail` is captured as a tenant-keyed HMAC digest (`keyed_digest`),
  never raw, so the evidence shows the field *changed* without revealing it.
- The UI shows an honest per-change dispatch status: **Dispatched to Cloud**,
  **Dispatch failed · retrying** (the outbox row stays pending for the next
  pass), or **Captured locally** when the cloud is not configured.

## Cloud vs. local-only

The example runs **local-only** by default and shows a "Local only" badge. To
dispatch end-to-end, set these three variables on the Express server and restart:

```sh
export VERITIO_CLOUD_BASE_URL=http://localhost:3010        # hosted Cloud origin
export VERITIO_CLOUD_PROJECT_ID=<project id>               # becomes scope.tenantId
export VERITIO_CLOUD_INGEST_TOKEN=vrt_...                  # an "ingest" scoped key
```

The dispatcher then POSTs each outbox entry as one `{events, edges}` batch to the
Cloud's `/api/ingest` (`Authorization: Bearer <token>`). The hosted ingest has no
CORS, which is why delivery is server-to-server and the token must stay on the
server. When the variables are unset, dispatch is skipped and changes are
captured locally only.

## Files

- `src/App.tsx` is the governed-change SPA: it loads the snapshot once on mount
  (a single guarded `fetch` + `AbortController`) and re-reads it after each
  action POST. It imports only result *types* from the server modules, so no
  Node-only code enters the client bundle.
- `server/index.ts` mounts Better Auth and adds the `/api/governed/*` routes.
- `server/cloud-ingest.ts` is the process-boundary module: it reads the
  `VERITIO_CLOUD_*` environment config and drains the outbox to hosted ingest via
  `@veritio/storage`. It is the only place the ingest token is read.
- `server/governed-entries.ts` is the governed-change engine: `defineEntity`, the
  in-memory entry/feed stores, the file-backed outbox, and `runGovernedAction`.
- `server/auth.ts` / `auth-events.ts` / `server/veritio.ts` are the Better Auth
  and reference-audit wiring (a runnable reference, not the shipped product).

## Run

```sh
cd examples/react-better-auth
bun install

# Terminal 1: Express server on http://localhost:3001
bun run dev:server

# Terminal 2: Vite client on http://localhost:5173 (proxies /api → :3001)
bun run dev
```

Open `http://localhost:5173`, then edit an entry, run the cost agent, or roll
back to record a governed change. With the cloud configured, click **View in
Veritio Cloud** to watch it land under Evidence → Changes.

API smoke:

```sh
curl http://localhost:3001/api/governed/snapshot
curl -X POST http://localhost:3001/api/governed/action \
  -H 'content-type: application/json' \
  -d '{"kind":"agent_recalc","entryId":"tower_a"}'
```

## Why It Works

Veritio is injected at the host boundary. The React app never submits tenant or
actor identifiers and never holds the ingest token; the Express server resolves
identity, captures deterministic tenant-scoped governed changes, and owns
delivery. The in-memory stores and file outbox make the sample runnable without a
database or a hosted account.

Before production use, replace the reference session with a real Better Auth
session plus tenant or organization membership lookup, inject a rotated
tenant-scoped HMAC secret instead of the demo digest key, and replace the
in-memory stores with durable storage. The Better Auth `secret` and `baseURL` in
`server/auth.ts` are local reference values only. Veritio supports compliance
evidence; it does not guarantee legal compliance.
