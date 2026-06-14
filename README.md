# Veritio

Veritio is an open-source evidence layer for modern applications.

It gives product teams a shared protocol and SDKs for audit events, consent history, data-subject workflows, retention policies, tamper-evident records, and compliance exports across frameworks and languages.

## What Veritio Is

- A protocol-first event model for app-level evidence.
- SDKs for TypeScript, Python, and Go.
- A first Better Auth adapter for server-side auth lifecycle evidence.
- Thin framework adapters for Next.js, TanStack Start, SvelteKit, React, Vue, and Svelte.
- Initial storage helpers for PostgreSQL/Neon, MySQL/MariaDB, MongoDB, and Redis tenant-tip caching.
- Planned framework adapters for Express, Hono, tRPC, and FastAPI.
- A planned self-hostable server path plus a future managed provider path.
- Planned UI surfaces for audit logs, consent history, and data-subject requests.

## What Veritio Is Not

- It is not legal advice.
- It does not make an application automatically GDPR, EAA, SOC 2, HIPAA, DORA, or NIS2 compliant.
- It is not only an audit-log table. The product boundary includes event evidence, retention, DSAR workflows, records of processing, export, and verification.

## TypeScript Quick Start

```ts
import { MemoryAuditStore, createAuditEvent } from "@veritio/core";

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
```

## Repository Layout

```txt
spec/                 Language-neutral event and audit-record schemas
sdks/typescript/      JS/TS SDK
sdks/python/          Python SDK
sdks/go/              Go SDK
storage/              Host-injected storage adapters
adapters/             Framework and library adapters
server/node/          Self-hosted ingestion/query API surface
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

See `docs/agent-setup.md` for Codex and Claude Code guidance.
