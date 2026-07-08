# Veritio Examples

These directories are reference project skeletons. They run outside the root
workspace package graph, so use the dedicated example gates when changing them:

```sh
bun run verify:examples
bun run verify:examples:browser
bun run verify:examples:docker
```

The examples keep Veritio setup on the server side, use stable IDs instead of
personal data, and require host applications to provide tenant scope before
recording. They are evidence-support examples for audit trails and data subject
workflows; they do not provide legal advice or automatic regulatory coverage.
The main copy-paste integration guide is `../docs/integrations.md`; templates
live in `../docs/templates/`.

## Better Auth Governed CRUD Showcases

- `nextjs-better-auth` shows Next.js App Router server actions and route
  handlers with Better Auth lifecycle hooks, governed-action CRUD drafts, graph
  edges, and a broader helper-driven lifecycle scenario.
- `tanstack-start-better-auth` shows TanStack Start server routes with Better
  Auth mounted at `/api/auth/$`, governed-action CRUD drafts, graph edges, the
  broader lifecycle scenario, and a governed-change Change/Entity/Explain/Diff
  browser smoke path.
- `react-better-auth` shows a Vite React client with an Express Better Auth
  server, governed-action CRUD drafts, graph edges, and a broader helper-driven
  lifecycle scenario.
- `vue-better-auth` shows the same Express-hosted Better Auth and governed CRUD
  flow from a Vite Vue client, including the broader lifecycle scenario.
- `sveltekit-better-auth` shows SvelteKit hooks and route handlers with Better
  Auth lifecycle hooks, governed-action CRUD drafts, graph edges, and the
  broader lifecycle scenario.

## Python and Go Governed CRUD Showcases

- `fastapi-governed-crud` shows Python FastAPI CRUD routes that append Veritio
  governed-action drafts, activity-graph edges, and EvidenceCommit envelopes
  from a server-owned tenant/actor boundary, plus a broader helper-driven
  lifecycle scenario.
- `gin-governed-crud` shows the same governed CRUD flow in Go Gin using the Go
  SDK helper and `httptest`, including EvidenceCommit verification for CRUD
  mutations and the broader helper-driven lifecycle scenario.

Both examples include Dockerfiles and local test suites. They run without a
hosted account; hosted Veritio Cloud wiring is documented as an optional
delivery target for the same records.

## Hosted-Compatible SDK Coverage

- `cloud-full-governance-poc` is the full non-agent/non-code SDK coverage
  harness for hosted-compatible ingest/read payloads. It covers all auth,
  organization, and data-lifecycle audit templates plus broad graph relations,
  and can post the same payload to a deployed hosted endpoint with env-injected
  scoped keys. Cloudflare Worker/Pages/R2/D1 deployment readiness is owned by
  `veritio-cloud`, not this OSS example.

## Risk Scoring

- `risk-scoring-walkthrough` is the deterministic, tested tour of the risk
  surface: per-step scoring, episode rollups, temperature-derived policies
  (`riskPolicy`), per-action frequency rules (a failed-login burst recorded
  through the real `@veritio/better-auth` adapter escalates to `critical`
  while the same actions spread out stay `low`), and `security.risk`
  assertions with stable canonical hashes.

## Integrity and Agent-Capture Showcases

- `verify-tamper-detection` shows the core TypeScript integrity story:
  hash-chained records verified with `verifyAuditRecords`, plus fail-closed
  detection of metadata edits, deleted records, reordered history, and
  EvidenceCommit manifest tampering.
- `claude-code-capture` drives the real `@veritio/claude-code` hook binary with
  simulated Claude Code hook payloads, then queries the captured session back
  and exports a verifiable bundle — proving raw prompts and file contents never
  reach the store (hashes only).

## Storage Skeletons

- `storage-postgres-neon`
- `storage-mysql-mariadb`
- `storage-mongodb`
- `storage-redis`
