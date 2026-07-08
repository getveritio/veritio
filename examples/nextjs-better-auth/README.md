# Next.js + Better Auth Governed Change Reference

Runnable Next.js 16 App Router reference that turns a real UI action into a
governed Veritio `Change` and dispatches it server-to-server to hosted Veritio
Cloud. Run `bun run verify:examples` from the repo root to build and typecheck it
with the rest of the examples.

This example mirrors the flagship TanStack Start and React references: the same
governed-change spine, the same shared `veritio-ui` design kit, and the same
honest local-only / dispatched UX. Tenant identity, the actor, the HMAC capture
material, and the ingest token all stay in server-only modules; the browser
never sees them.

## What It Shows

- `app/page.tsx` is a server component. It reads the current governed snapshot
  (entries, change feed, cloud status) directly from `src/server/governed-entries.ts`
  — no client fetch, no API route.
- `app/_components/entry-card.tsx` is the only client component. The edit-form
  toggle and rollback-target selection are local UI state; every governed action
  (edit, run cost agent, roll back) is sent to a server action.
- `app/actions/governed.ts` is the `"use server"` boundary. It runs the SDK
  capture, the transactional-outbox enqueue, and the server-to-server dispatch to
  hosted ingest, then `revalidatePath("/")` so the new revision renders.
- `src/server/governed-entries.ts` builds each governed `Change` with
  `createGovernedActionDraft`, applies the local mutation and enqueues the outbox
  entry together, and bumps a monotonic `version` field so a rollback is a
  genuinely new revision with a distinct state digest. `customerEmail` is captured
  as a tenant-keyed HMAC digest, never raw.
- `src/server/cloud-ingest.ts` reads `VERITIO_CLOUD_*` env at the process
  boundary and uses the `@veritio/storage` HTTP dispatcher to drain the outbox to
  Cloud. `dispatchBatchToCloud` posts the agent session's pure-evidence records
  directly (one `postBatch`, outside the per-mutation outbox). The browser only
  ever receives the token-free `cloudPublicConfig()`.
- `src/server/governed-session.ts` is the agent-session capability. One call runs
  a full governed AI workflow with `createProvenanceRecorder` — session → prompt →
  tool read → proposal → file change → human approval — and drives the actual
  governed re-estimations, every event stamped with one `sessionId` so the Cloud
  groups them into a single session (Agent Sessions / Activity Graph / Code
  Changes surfaces). Prompts and document contents are hashed, never raw.
  `app/_components/agent-sessions.tsx` is the client trigger + recent-sessions list.
- `app/api/auth/[...all]/route.ts` mounts Better Auth, and its
  `databaseHooks.user.create.after` records a Veritio audit event through
  `src/veritio/auth-events.ts` using a server-resolved tenant.

## Files

- `app/page.tsx` — governed-change dashboard (server component).
- `app/_components/entry-card.tsx` — client card with the three governed actions.
- `app/_components/agent-sessions.tsx` — client trigger + recent agent-sessions list.
- `app/_components/dispatch-badge.tsx` — shared dispatch-status pill.
- `app/actions/governed.ts` — server actions that record + dispatch (mutation + agent session).
- `src/server/governed-entries.ts` — the governed-action engine and in-memory store.
- `src/server/governed-session.ts` — the agent-session engine (provenance recorder).
- `src/server/cloud-ingest.ts` — env-at-boundary cloud config + outbox/batch dispatchers.
- `src/veritio/server.ts` — Better Auth recorder, store, and reference session.
- `src/veritio/auth.ts` / `auth-events.ts` — Better Auth → Veritio bridge.
- `app/api/auth/[...all]/route.ts` — mounts Better Auth.
- `src/veritio-ui/` — the shared example design kit (copied from `examples/_shared`).

## Run

```sh
cd examples/nextjs-better-auth
bun install
bun run typecheck
bun run build
bun run dev
```

Open `http://localhost:3000`. Edit an entry, run the cost agent, or roll back to
a prior revision; each records one governed `Change` and (when configured)
dispatches it to Veritio Cloud. The change feed shows the honest dispatch status.

## Connect to Veritio Cloud

By default the example runs **local-only** and skips network dispatch. To
dispatch end to end, set these in `.env.local` (server-only — never `NEXT_PUBLIC_`):

```sh
VERITIO_CLOUD_BASE_URL=http://localhost:3010
VERITIO_CLOUD_PROJECT_ID=<the Cloud project id (becomes scope.tenantId)>
VERITIO_CLOUD_INGEST_TOKEN=vrt_...   # an "ingest"-authority scoped key
```

Restart the dev server, then open the Cloud → Evidence → Changes surface to watch
entries land. The hosted ingest rejects a batch unless `scope.tenantId` equals
the key's project, so the project id IS the tenant.

## Why It Works

Next route handlers and server actions are host boundaries. Veritio receives
already-resolved tenant and actor identity from those boundaries, captures a
deterministic governed change, stages it in a transactional outbox, and
dispatches it server-to-server. The sample is zero-config and in-memory, so it
works without hosted Veritio, a database, or auth provider credentials.

Before production use, replace the reference session with a real Better Auth
session plus tenant or organization membership lookup, replace the in-memory
stores with durable storage, and inject a rotated tenant-scoped HMAC secret. The
Better Auth `secret` and `baseURL` in `src/veritio/auth.ts` are local reference
values only.
