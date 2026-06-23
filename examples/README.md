# Veritio Examples

These directories are reference project skeletons. They are not included in the
root `bun run verify` workspace gate, so install and verify each example from
inside its own directory when you turn it into an application.

The examples keep Veritio setup on the server side, use stable IDs instead of
personal data, and require host applications to provide tenant scope before
recording. They are evidence-support examples for audit trails and data subject
workflows; they do not provide legal advice or automatic regulatory coverage.

## Better Auth Governed CRUD Showcases

- `nextjs-better-auth` shows Next.js App Router server actions and route
  handlers with Better Auth lifecycle hooks, CRUD audit events, graph edges, and
  a broader helper-driven lifecycle scenario.
- `tanstack-start-better-auth` shows TanStack Start server routes with Better
  Auth mounted at `/api/auth/$`, CRUD audit events, graph edges, and the broader
  lifecycle scenario.
- `react-better-auth` shows a Vite React client with an Express Better Auth
  server, CRUD audit events, graph edges, and a broader helper-driven lifecycle
  scenario.
- `vue-better-auth` shows the same Express-hosted Better Auth and governed CRUD
  flow from a Vite Vue client, including the broader lifecycle scenario.
- `sveltekit-better-auth` shows SvelteKit hooks and route handlers with Better
  Auth lifecycle hooks, CRUD audit events, graph edges, and the broader
  lifecycle scenario.

## Python and Go Governed CRUD Showcases

- `fastapi-governed-crud` shows Python FastAPI CRUD routes that append Veritio
  audit events and activity-graph edges from a server-owned tenant/actor
  boundary, plus a broader helper-driven lifecycle scenario.
- `gin-governed-crud` shows the same governed CRUD flow in Go Gin using the Go
  SDK and `httptest`, plus a broader helper-driven lifecycle scenario.

Both examples include Dockerfiles and local test suites. They run without a
hosted account; hosted Veritio Cloud wiring is documented as an optional
delivery target for the same records.

## Veritio Cloud SDK Coverage

- `cloud-full-governance-poc` is the full non-agent/non-code SDK coverage
  harness for deployed Cloud ingest/read. It covers all auth, organization, and
  data-lifecycle audit templates plus broad graph relations, and can post the
  same payload to `https://console.getveritio.com` with env-injected scoped keys.

## Storage Skeletons

- `storage-postgres-neon`
- `storage-mysql-mariadb`
- `storage-mongodb`
- `storage-redis`
