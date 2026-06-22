# Veritio

Veritio is an open-source evidence layer for modern applications.

It gives product teams a shared protocol and SDKs for audit events, evidence graph edges, consent history, data-subject workflows, retention policies, tamper-evident records, and compliance exports across frameworks and languages.

## What Veritio Is

- A protocol-first event and graph-edge model for app-level evidence.
- SDKs for TypeScript, Python, and Go.
- A first Better Auth adapter for server-side auth lifecycle evidence.
- Thin framework adapters for Next.js, TanStack Start, SvelteKit, React, Vue, and Svelte.
- Initial storage helpers for PostgreSQL/Neon, MySQL/MariaDB, MongoDB, and Redis tenant-tip caching.
- Planned framework adapters for Express, Hono, tRPC, and FastAPI.
- A planned self-hostable server path plus a future managed provider path.
- A local Workbench and MCP development loop for inspecting local evidence quality.
- Planned hosted UI surfaces for audit logs, consent history, and data-subject requests.

## What Veritio Is Not

- It is not legal advice.
- It does not make an application automatically GDPR, EAA, SOC 2, HIPAA, DORA, or NIS2 compliant.
- It is not only an audit-log table. The product boundary includes event evidence, graph links, retention, DSAR workflows, records of processing, export, and verification.

## TypeScript Quick Start

```ts
import { MemoryAuditStore, createAuditEvent, createEvidenceEdge } from "@veritio/core";

const store = new MemoryAuditStore();

const event = createAuditEvent({
  id: "evt_01",
  occurredAt: "2026-06-10T00:00:00.000Z",
  actor: { type: "user", id: "usr_123" },
  action: "org.member.invited",
  target: { type: "organization", id: "org_123" },
  scope: { tenantId: "org_123", environment: "production" },
  purpose: "access_management",
  lawfulBasis: "contract",
  retention: "security_1y",
  metadata: {
    inviteId: "inv_123",
    role: "viewer"
  }
});

await store.append(event);

const edge = createEvidenceEdge({
  id: "edge_01",
  occurredAt: "2026-06-10T00:00:01.000Z",
  scope: { tenantId: "org_123", environment: "production" },
  from: { type: "actor", id: "usr_123", actorType: "user" },
  relation: "created",
  to: { type: "runtime_event", id: "evt_01" },
  metadata: {
    reason: "member_invite"
  }
});
```

## Audit Templates

SDKs include helper templates for common auth, organization, data, agent, and
code-change audit events. They return normal audit-event inputs, so hosts can
still use their own recorder and storage boundaries:

```ts
import { auditTemplates, createAuditEvent } from "@veritio/core";

const event = createAuditEvent(
  auditTemplates.organization.created({
    organizationId: "org_123",
    actor: { type: "user", id: "usr_owner" },
  }),
);
```

Auth templates include hashed/coarse sign-in context fields. Agent and
code-change templates use `metadata.sessionId` for grouping and reject raw
prompt, diff, path, stdout/stderr, tool-argument, and bearer-token-like
metadata.

Use `auditLogClassificationMetadata` when a host wants portable filters for
audit streams without adding protocol fields. It normalizes visibility labels
such as `customer`/`public` to `metadata.logVisibility = "external"` and
surface labels such as `REST`/`dashboard` to `metadata.logSurface = "api"` or
`"app"`. Canonical visibility values are `internal`, `external`, `partner`,
and `system`; canonical surfaces are `api`, `app`, `worker`, `cli`, and
`webhook`.

## Local Workbench

```sh
veritio dev --mcp
```

This starts the OSS local Workbench at `http://127.0.0.1:4983` with:

- local event and edge ingest endpoints
- evidence graph query
- chain verification
- export bundle preview
- browser Workbench UI
- MCP JSON-RPC endpoint at `/mcp`

MCP write tools are disabled by default. Use `--allow-write-tools` only for
explicit local development sessions.

## Repository Layout

```txt
spec/                 Language-neutral event, edge, and record schemas
sdks/typescript/      JS/TS SDK
sdks/python/          Python SDK
sdks/go/              Go SDK
storage/              Host-injected storage adapters
adapters/             Framework and library adapters
server/node/          Self-hosted ingestion/query API surface
cli/                  Local Workbench and MCP CLI
docs/                 Product, architecture, and hosted-provider docs
examples/             Integration guides and runnable examples
.agents/              Codex-style local skills
.codex/               Codex agent and hook configuration
.claude/              Claude Code rules, agents, skills, and hooks
.github/              GitHub workflow configuration
```

## Initial Modules

- `@veritio/core`: TypeScript SDK.
- `@veritio/better-auth`: Better Auth adapter.
- `@veritio/storage`: host-injected storage helpers.
- `@veritio/next`: Next.js server-side adapter.
- `@veritio/tanstack-start`: TanStack Start server-side adapter.
- `@veritio/sveltekit`: SvelteKit server-side adapter.
- `@veritio/react`: React UI intent helpers.
- `@veritio/vue`: Vue UI intent helpers.
- `@veritio/svelte`: Svelte UI intent helpers.
- `@veritio/express`: planned Express adapter.
- `@veritio/hono`: planned Hono adapter.
- `@veritio/trpc`: planned tRPC adapter.
- `veritio-fastapi`: planned FastAPI adapter.
- `veritio`: Python SDK package.
- `github.com/getveritio/veritio/sdks/go`: Go SDK module.

## License

Apache-2.0.

## Agent Setup

See `AGENTS.md` and `CLAUDE.md` for agent guidance. Local execution specs, if
present, live under ignored `.codex/private/specs/` paths and are not published.
