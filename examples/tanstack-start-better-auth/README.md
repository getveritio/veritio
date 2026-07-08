# TanStack Start — Governed Change → Veritio Cloud (end to end)

A runnable TanStack Start reference where a **real UI action** becomes a governed
`Change` and travels all the way to the hosted Veritio Cloud:

```
edit an entry / run the cost agent / roll back
  → @veritio/core createGovernedActionDraft        (change.declared + activity + entity.revision)
  → @veritio/storage transactional outbox           (staged with the local mutation)
  → server-to-server POST to Veritio Cloud /api/ingest   (Bearer ingest key — server only, no CORS)
  → appears live in the Cloud's Evidence → Changes / Entities surfaces
```

Tenant and the ingest key are resolved on the server and never reach the browser.
This example matches the hosted Cloud's visual language (shared design kit in
`examples/_shared/veritio-ui`): OKLCH zinc tokens, Geist, the dot-grid surface, and
emerald reserved for the brand mark and success only.

This is a reference example, not the shipped product. Veritio supports compliance
evidence; it does not make an application automatically compliant.

## What It Shows

- **Three real governed actions** on a versioned `project_entry`: **Edit**
  (before/after computed at request time), **Run cost agent** (recalculates the
  estimate; `initiatedBy` a user, `performedBy` an `ai_agent`), and **Roll back**
  (restores a prior revision's values). Each emits one `change.declared` record —
  the unit the Cloud Changes surface projects.
- **Agent sessions** (`src/server/governed-session.ts`). **Run agent session**
  models a full governed AI workflow with `createProvenanceRecorder`: a cost agent
  (model + human enforcer) opens an `agent.session.started`, records its prompt,
  tool reads, a change proposal and file change, then drives the governed
  re-estimations as entity revisions — every event stamped with one `sessionId` —
  and a human review approves it. One click populates the Cloud's **Agent
  Sessions, Activity Graph, and Code Changes** surfaces in addition to
  Changes/Entities. Prompts and document contents are hashed, never raw.
- **Transactional outbox, honestly.** `createGovernedActionDraft().outboxEntry` is
  enqueued through `createFileOutboxAdapter` in the same step as the local
  mutation, then drained to hosted ingest by `createHttpOutboxDispatcher` +
  `createHttpIngestTarget` (`@veritio/storage`). The UI shows **Dispatched /
  Dispatch failed (retrying) / Captured locally** — never a vague "verified".
- **Versioned revisions.** Every change bumps a monotonic `version` governed
  field, so even a rollback that restores prior values is a genuinely new revision
  with a distinct state digest.
- **Minimized evidence.** `customerEmail` is captured as a `keyed_digest`; the raw
  value stays app-side and never enters the evidence.
- **Local-only mode** out of the box (no Cloud needed); configure the Cloud to
  dispatch end to end.

## Files

- `src/server/cloud-ingest.ts` — server boundary: reads `VERITIO_CLOUD_*` env and
  drives the `@veritio/storage` HTTP dispatcher. The only place the ingest token
  is read; the browser gets a token-free `cloudPublicConfig()`.
- `src/server/governed-entries.ts` — `defineEntity(project_entry)`, the entry/feed
  stores, and `runGovernedAction` (create / update / agent recalc / re-estimate /
  rollback): build draft → enqueue outbox → dispatch. Change ids carry a
  per-process run id so a restart's reset in-memory store never collides with
  evidence already in the Cloud.
- `src/server/governed-session.ts` — the agent-session capability: a collecting
  provenance sink + `createProvenanceRecorder`, delivering a session's recorder
  evidence as a direct batch while its governed re-estimations flow through the
  outbox, all under one `sessionId`.
- `src/server/actions.ts` — typed `createServerFn` RPC boundary (`getGovernedSnapshot`,
  `runGovernedActionFn`, `runAgentSessionFn`); server-only code is kept out of the
  client bundle.
- `src/routes/index.tsx` — the UI: dot-grid shell, entry cards with the three
  actions, live dispatch status, change feed, and "View in Veritio Cloud".
- `src/veritio-ui/` — the shared Veritio design kit, copied in.
- `src/server/auth.ts` / `auth-events.ts` — Better Auth wiring (reference only).

## Run

```sh
cd examples/tanstack-start-better-auth
bun install
bun run dev            # http://localhost:5173
```

Edit an entry, run the cost agent, or roll back — each records a governed change
(in **Local only** mode it is captured locally and the feed updates).

## Configure the Cloud (full end-to-end)

1. In the Veritio Cloud console, create a **project**, then create a scoped key
   with the **`ingest`** authority and copy the one-time `vrt_…` token.
2. Provide these as **server environment variables** when you start the dev
   server — `VERITIO_CLOUD_BASE_URL` (your Cloud base URL),
   `VERITIO_CLOUD_PROJECT_ID` (becomes `scope.tenantId`), and
   `VERITIO_CLOUD_INGEST_TOKEN` (the `vrt_…` ingest key, read only on the server):
   ```sh
   VERITIO_CLOUD_BASE_URL=http://localhost:3010 \
   VERITIO_CLOUD_PROJECT_ID=<the project id> \
   VERITIO_CLOUD_INGEST_TOKEN=vrt_… \
   bun run dev
   ```
   (Or put them in a `.env` if your local dev server loads it into `process.env`.)
3. Perform an action and watch it land in the Cloud under **Evidence → Changes**
   (the "View in Veritio Cloud" link deep-links there).

The ingest endpoint has no CORS, so dispatch is server-to-server only — the UI
action hits this example's own server, which delivers to the Cloud.

## Why It Works

The host application stays authoritative for business state; Veritio stores the
captured revision, state commitment, and minimized fields. Identity and the ingest
key live at the server boundary, so framework routing and the browser never become
part of the protocol or hold a secret. Before production use, replace the reference
session with a real Better Auth session + organization/tenant lookup, and back the
outbox and stores with durable storage. The Better Auth `secret`/`baseURL` in
`src/server/auth.ts` are local reference values only.
