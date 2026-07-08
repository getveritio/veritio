# Vue + Better Auth Governed-Change Example

Runnable Vite + Vue 3 SPA backed by an Express server. A real UI action — edit an
entry, run the cost agent, or roll back — becomes a governed **Change**: it is
captured through the SDK's `createGovernedActionDraft`, staged in a transactional
outbox, and dispatched server-to-server to the hosted Veritio Cloud, where it
appears live under **Evidence → Changes**.

The browser only ever calls same-origin `/api/governed/*` routes. Tenant scope,
actor identity, the HMAC digest key, and the hosted ingest token all stay on the
Express server. The browser never sees the token.

This example shares the framework-agnostic server spine with the React reference
(`examples/react-better-auth`) and the same shared design kit
(`examples/_shared/veritio-ui`). Vue cannot consume the kit's React primitives,
so it imports only the kit's `styles.css` and re-authors the leaf components as
Vue SFCs (`src/veritio-ui/*`) against the same CSS-variable tokens and class
strings — so the rendered result matches the product and the React example.

## What It Shows

- `GET /api/governed/snapshot` returns the current governed entities, the recent
  change feed, the recent agent sessions, and a **browser-safe** cloud config
  (configured/base URL/project id only — never the ingest token).
- `POST /api/governed/action` runs one governed action (`create`, `update`,
  `agent_recalc`, `rollback`). The body is validated and fails closed before it
  can affect an entry id, actor id, or rollback target.
- `POST /api/governed/session` runs one governed **agent session** with
  `createProvenanceRecorder`: a cost agent (model + human enforcer) opens an
  `agent.session.started`, records its prompt, tool reads, a change proposal and
  file change, then drives the governed re-estimations as entity revisions — every
  event stamped with one `sessionId` — and a human review approves it. One click
  populates the Cloud's **Agent Sessions, Activity Graph, and Code Changes**
  surfaces in addition to Changes/Entities. Prompts and document contents are
  hashed, never raw.
- Each action resolves before/after rows, builds a governed-action draft with
  `createGovernedActionDraft`, applies the local mutation AND enqueues the
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
captured locally only. An agent session's recorder evidence (session / prompt /
tool / proposal / review records) is pure evidence with no local mutation to
stage, so it is posted as a direct batch (`dispatchBatchToCloud`) rather than
through the outbox, while its governed re-estimations still flow through it.

## Files

- `src/App.vue` is the governed-change SPA: it loads the snapshot once on mount
  (a single guarded `fetch` + `AbortController`) and re-reads it after each
  action POST. It imports only result *types* from the server modules, so no
  Node-only code enters the client bundle.
- `src/components/EntryCard.vue` is one governed entity card (Edit / Run cost
  agent / Roll back); it emits actions up to `App.vue` and never builds a change.
- `src/components/AgentSessions.vue` is the agent-session section: the **Run agent
  session** trigger plus the recent-sessions list; it emits the run up to
  `App.vue` and never builds the session.
- `src/veritio-ui/*` are the re-authored Vue SFC leaf components (`Button`,
  `Card` + `CardHeader`/`CardContent`, `Badge`, `Input`) plus the `cn` helper —
  same tokens and class strings as the shared kit's `react/*` primitives.
- `server/index.ts` mounts Better Auth (`/api/auth/*splat`, before
  `express.json()` so Better Auth owns auth request parsing) and serves the three
  `/api/governed/*` routes (`snapshot`, `action`, `session`).
- `server/cloud-ingest.ts` is the process-boundary module: it reads the
  `VERITIO_CLOUD_*` environment config and both drains the outbox and posts
  agent-session batches (`dispatchBatchToCloud`) to hosted ingest via
  `@veritio/storage`. It is the only place the ingest token is read.
- `server/governed-entries.ts` is the governed-action engine: `defineEntity`, the
  in-memory entry/feed stores, the file-backed outbox, a per-process run id so a
  restart's reset in-memory store never collides with evidence already in the
  Cloud, and `runGovernedAction`.
- `server/governed-session.ts` is the agent-session capability: a collecting
  provenance sink + `createProvenanceRecorder`, delivering a session's recorder
  evidence as a direct batch while its governed re-estimations flow through the
  outbox, all under one `sessionId`.
- `server/auth.ts` / `auth-events.ts` / `server/veritio.ts` are the Better Auth
  wiring: the local auth instance, the `databaseHooks.user.create.after` hook
  that maps user creation to a Veritio audit event, and the recorder +
  server-owned reference session it writes through (a runnable reference, not the
  shipped product).

## Run

```sh
cd examples/vue-better-auth
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

Veritio is injected at the host boundary. The Vue app never submits tenant or
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
