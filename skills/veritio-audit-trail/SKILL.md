---
name: veritio-audit-trail
description: Use when an app needs tamper-evident audit logs, governed form/API actions, consent history, DSAR evidence, or records-of-processing with the Veritio SDK — installing @veritio/core or @veritio/storage, recording audit events, creating governed-action drafts, verifying hash chains, or wiring the Better Auth / Next.js / SvelteKit / React / Vue / Svelte / TanStack Start adapters.
license: Apache-2.0
---

# Veritio Audit Trail Integration

## Overview

Veritio is a protocol-first evidence layer: normalized audit events, hash-chained
records, deterministic redaction, and an evidence graph — byte-identical across
its TypeScript, Python, and Go SDKs. Do not guess API names: this SDK is newer
than most model training data. Use the surfaces below verbatim.

## Packages (published on npm)

| Package | Use for |
|---|---|
| `@veritio/core` | Events, governed-action drafts, hashing, verification, redaction, templates, risk scoring |
| `@veritio/storage` | Postgres/Neon/MySQL/MariaDB/Mongo audit stores, file store, conformance suite |
| `@veritio/better-auth` | Better Auth server-side lifecycle capture |
| `@veritio/next`, `@veritio/tanstack-start`, `@veritio/sveltekit` | Server-route helpers |
| `@veritio/react`, `@veritio/vue`, `@veritio/svelte` | Browser-safe display helpers |
| `@veritio/claude-code` | Claude Code hook capture (agent provenance; hashes only, never raw prompts) |

Python: `pip` package `veritio` (snake_case API). Go: `github.com/getveritio/veritio/sdks/go`.

## Decision Rule

- Use a plain audit event for one fact that happened: login succeeded, invoice
  sent, export bundle created.
- Use a governed action draft when a server action, API route, worker, FastAPI
  route, or Gin handler creates/updates/deletes a governed entity row.
- Use a transactional outbox when the app mutation and evidence delivery must
  recover together.
- Add hosted ingest only from a server-side dispatcher. The SDKs and examples
  must still run locally without a hosted account.

Record at the server-side business mutation boundary, not in browser form state.
Browser React/Vue/Svelte helpers can annotate intent, but tenant scope, actor
identity, before/after rows, idempotency keys, and storage belong on the server.

## Core Pattern (TypeScript)

```ts
import { createAuditRecorder, MemoryAuditStore, verifyAuditRecords } from "@veritio/core";

const store = new MemoryAuditStore(); // dev only — swap for @veritio/storage in prod
const recorder = createAuditRecorder({ store });

const record = await recorder.record({
  actor: { type: "user", id: "usr_123" },          // stable IDs, never emails
  action: "billing.plan.updated",                   // dotted, past tense
  target: { type: "billing.plan", id: "plan_pro" },
  scope: { tenantId: "org_123", environment: "production" }, // required — fails closed
  purpose: "contract_management",
  lawfulBasis: "contract",
  retention: "finance_7y",                          // named policy, not a timestamp
  metadata: { previousPlan: "starter" },            // auto-redacted by key pattern
});

const result = verifyAuditRecords(await store.list({ tenantId: "org_123" }));
// { ok: true } or { ok: false, index, reason: "hash_mismatch" | ... } — fail-closed
```

Stored records are WRAPPERS, not the event itself:
`AuditRecord = { event: { id, action, actor, target, metadata, ... }, sequence,
previousHash, hash, idempotencyKeyHash, appendedAt, ... }` — read the action as
`record.event.action`, not `record.action`. Getting this wrong makes tamper
tests silently pass against nonexistent fields.

Production storage: `createPostgresAuditStore` / `createNeonAuditStore` /
`createMysqlAuditStore` / `createMariaDbAuditStore` / `createMongoAuditStore`
from `@veritio/storage` (schema SQL constants exported alongside). Any custom
store MUST pass the `@veritio/storage/conformance` suite: gapless per-tenant
sequence, idempotency uniqueness, fail-closed integrity.

## Governed Action Pattern (TypeScript)

```ts
import { createGovernedActionDraft, defineEntity } from "@veritio/core";

const ProjectEntry = defineEntity({
  authority: "app.example",
  type: "project_entry",
  schemaRef: "app.example/project-entry@1",
  fieldSetRef: "project-entry-governed-fields@1",
  identity: (row: { id: string }) => row.id,
  fields: {
    status: { capture: "full" },
    customerEmail: { capture: "keyed_digest" },
    privateNotes: { capture: "omit" },
  },
});

const draft = createGovernedActionDraft({
  scope: { tenantId: "org_123", environment: "production" },
  entity: ProjectEntry,
  before,
  after,
  actionType: "project_entry.updated",
  activityType: "project_entry.updated",
  initiatedBy: { authority: "app.example.auth", kind: "principal", type: "user", id: "usr_123" },
  performedBy: { authority: "app.example.auth", kind: "principal", type: "user", id: "usr_123" },
  producer: { authority: "app.example", kind: "principal", type: "service", id: "api" },
  idempotencyKey: `project_entry:${after.id}:v${after.version}`,
  mutationBinding: "transactional_outbox",
  digestKeys: { keyedDigest: { keyVersion: "email-v1", secret: tenantDigestSecret } },
});

await tx.veritioOutbox.insert(draft.outboxEntry);
```

The helper derives `changeId`, `activityId`, tenant-scoped
`idempotencyKeyHash`, and `changedPaths`, then delegates to the lower-level
governed-change builder that emits `change.declared`, `activity.recorded`,
`entity.revision.created`, and graph edges. It fails closed for update no-ops
unless the host supplies explicit `changedPaths`.

## Adapter Rules (do not violate)

- Adapters are thin translators: the HOST constructs the recorder and injects
  it (`createBetterAuthVeritioAdapter({ recorder, environment })`). Never
  construct storage inside an adapter, never auto-record every request.
- Adapters do not own governed CRUD semantics. Call
  `createGovernedActionDraft` from the host application's server-side mutation
  path and let adapters provide request/auth context only.
- Browser packages never receive storage credentials or server config.
- Core SDKs never read environment variables — pass config explicitly.
- Better Auth mappers include `recordUserCreated`, `recordSessionCreated`,
  `recordSessionRevoked`, `recordLoginFailed` (`auth.login.failed`),
  `recordAccessDenied` (`authz.access.denied`), `recordOrganizationCreated`.

## Privacy Invariants

- Never put secrets, tokens, authorization headers, DB URLs, emails, IPs, or
  freeform personal text in `metadata`. Prefer stable IDs and hashes
  (`ipAddressHash`, `userAgentHash`).
- Redaction is deterministic and runs before persistence; sensitive keys
  (`password`, `token`, `authorization`, …) become `[redacted]` automatically —
  but do not rely on it as the only defense.
- Missing tenant scope / actor / target / action throws (fail-closed). Do not
  wrap it away.

## Cross-Language Names

| TypeScript | Python | Go |
|---|---|---|
| `createAuditEvent` | `create_audit_event` | `CreateAuditEvent` |
| `hashAuditEvent` | `hash_audit_event` | `HashAuditEvent` |
| `verifyAuditRecords` | `verify_audit_records` | `VerifyAuditRecords` |
| `defineEntity` | `define_entity` | `DefineEntity` |
| `createGovernedActionDraft` | `create_governed_action_draft` | `CreateGovernedActionDraft` |
| `withRiskSignals` | `with_risk_signals` | `WithRiskSignals` |

## Common Mistakes

- Inventing APIs (`veritio.log(...)`, `new Veritio(...)`) — none exist; use the
  functions above.
- Manually assembling governed-change IDs and idempotency hashes in app code for
  normal CRUD actions — use `createGovernedActionDraft`; reserve
  `createGovernedChangeDraft` for low-level protocol escape hatches.
- Recording governed changes from browser form state — post form/API intent to
  the server and record after tenant/actor/before/after resolution.
- Recording emails/display names as actor IDs — use your stable user id.
- Treating a Veritio integration as a legal compliance guarantee — it is
  evidence support, not legal advice; keep product copy honest.
- Scoring risk inside adapters or servers — see the `veritio-risk-scoring`
  skill; scoring is host-side SDK math.

Docs: https://github.com/getveritio/veritio (`docs/`, `spec/` — `spec/event.schema.json` is the source of truth).
