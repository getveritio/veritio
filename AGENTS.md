# AGENTS.md - Veritio OSS / SDK

Veritio is a protocol-first OSS evidence layer for application audit trails, consent history, DSAR workflows, retention, and compliance exports.

## Repository Boundary

This repository owns the public OSS/SDK layer:

- language-neutral protocol specs
- TypeScript, Python, and Go SDKs
- framework adapters
- host-injected storage helpers
- self-hosted server modules
- local Workbench and local MCP tooling when implemented
- local verifier and export bundle format
- conformance fixtures and examples

It does not own:

- public marketing website implementation (`veritio-website`)
- hosted SaaS/PaaS implementation (`veritio-cloud`)
- billing, hosted regions, hosted admin, hosted customer portals, or private operations

Hosted Veritio must consume this repo through public package boundaries or explicit
local development links. Hosted-only fields must not become protocol semantics.

## Codex Orientation

- Read any local hidden execution specs under `.codex/private/specs/` when
  present. Those files are intentionally ignored and must not be committed.
- Route cross-repo work with the inline boundaries in this file before making
  changes that might involve a sibling repository.
- Use `split-orchestrator` for multi-repo work that should be controlled from
  this repo instead of separate chats.
- Use `repo-routing-reviewer` when a change could belong in `veritio-website`
  or `veritio-cloud`.

## Product Rules

- Veritio is not legal advice and must not claim automatic GDPR, EAA, SOC 2, HIPAA, DORA, or NIS2 compliance.
- Prefer "evidence support", "audit trail", "records of processing", and "data subject workflow" over "guaranteed compliance".
- Keep the core protocol language-neutral. SDKs in TypeScript, Python, and Go must share the same event semantics.
- Do not make any framework adapter authoritative for the event model.
- Keep OSS useful without a hosted account, hosted project id, hosted API key, hosted billing, or proprietary storage.

## Engineering Rules

- This repo may hold cross-repo coordination docs, prompts, and scripts, but it
  must not absorb website or hosted SaaS/PaaS implementation code.
- Internal product specs, execution prompts, roadmap details, and private
  orchestration notes must stay in ignored local paths or private repos. Do not
  publish them in public docs.
- Core packages must not read process environment variables directly. Inject configuration at the host boundary.
- Default APIs must avoid collecting unnecessary personal data.
- Metadata redaction must be explicit and deterministic.
- Hashing, canonical JSON, idempotency keys, and storage ordering must be deterministic and tested.
- Storage adapters must fail closed when required fields, tenant scope, or integrity data are missing.
- Storage has a hard authoritative/derived boundary. Authoritative = a
  conforming `AuditStore` (Postgres/Neon, MySQL/MariaDB, MongoDB regular
  collection, file store) that passes `@veritio/storage/conformance`: gapless
  per-tenant sequence, idempotency-conflict rejection, expected-previous-hash
  checks, hash-revalidated reads. Derived = the object-storage archive
  (Cloudflare R2 / AWS S3 via an injected `ObjectArchiveClient`) and the
  ClickHouse read model (injected `ClickHouseExecutor`): eventually
  consistent, at-least-once projection, never sequence owners, never the
  authoritative answer for verify or DSAR. Object storage cannot couple
  sequencing to idempotency atomically and ClickHouse has no synchronous
  unique constraints — do not promote either to an `AuditStore`.
- Derived tiers must carry the exact `canonicalJson` record bytes as opaque
  strings (NDJSON segment lines in the archive; a raw `String` column in
  ClickHouse — never a driver's native JSON type) and must recompute record
  hashes on both write and read so corrupted or re-encoded bytes fail closed.
- Storage adapters are proven against real databases locally via
  `storage/docker-compose.yml` (`bun run --cwd storage db:up`, then
  `bun run --cwd storage test:live`); CI runs the same env-gated suites
  through service containers in `.github/workflows/verify.yml`. The MongoDB
  target must be a replica set (transactions) and the live suites skip
  silently when their `VERITIO_*_TEST_*` variables are absent.
- Avoid vendor lock-in in OSS modules. Hosted-provider features belong behind optional clients or server modules.
- If a change affects event semantics, graph edges, canonical JSON, hashing, redaction, idempotency, or export manifests, update this OSS repo before hosted code.
- Every named function, exported helper, class method with protocol/storage
  behavior, route handler, and CLI entrypoint must have a leading documentation
  comment so future agents can preserve intent. TypeScript/JavaScript should use
  the slash-star JSDoc form:
  ```ts
  /**
   * Describe the boundary, invariant, side effect, or framework contract this
   * function protects. Mention tenant scope, hashing, redaction, idempotency,
   * storage ordering, or hosted/OSS boundaries when relevant.
   */
  ```
- In Python use function docstrings; in Go use Go doc comments; in shell use
  `#` comment blocks. Keep the same level of detail even when the language
  cannot use slash-star comments.
- Do not add empty comments that only restate the function name. If a function
  is worth keeping, document why it exists, what it must not break, and any
  non-obvious runtime or framework assumption.
- Before using framework or build-tool APIs that may have changed recently
  (TanStack Start, Vinxi, Vite, Better Auth, Cloudflare Workers, SvelteKit,
  Next.js, Astro, tRPC, etc.), verify current official docs or installed package
  behavior. Do not rely on stale training-memory assumptions; record the current
  source of truth in comments or docs when it prevents repeat failures.
- For TanStack Start specifically, current React docs configure Start through
  Vite/Rsbuild build-tool plugins and Vite scripts such as `vite dev` and
  `vite build`; do not reintroduce old `vinxi dev` / `vinxi build` assumptions
  unless current package docs or installed package metadata prove that is correct.

## Naming

- Working brand: Veritio.
- Working hosted domain: getveritio.com.
- Use `@veritio/*` for npm packages and `veritio` / `veritio-*` for non-JS packages where available.

## Split Commands

- All repos: `bun run verify:split`
- Website and cloud only: `bun run verify:siblings`
- Split git status: `bun run status:split`

## Split Routing

- `veritio`: public protocol, schemas, SDKs, framework adapters, storage
  helpers, self-hosted server modules, verifier, export format, conformance
  fixtures, and public examples.
- `veritio-website`: public Astro website, docs pages, SEO metadata, marketing
  copy, public examples, and static assets.
- `veritio-cloud`: private hosted SaaS/PaaS implementation, hosted ingest,
  hosted MCP, managed storage, billing, regions, customer portals, admin, and
  operational jobs.
- Define portable protocol and SDK behavior here before implementing hosted
  behavior in `veritio-cloud`; publish website claims only after backing OSS or
  hosted behavior exists.

## Release & Integration Map

Who consumes what, and what a release actually requires. Check this before
bumping versions or assuming an integration needs an update.

- **Core release train (versions move together):** `@veritio/core`
  (`sdks/typescript`), `@veritio/storage`, `@veritio/claude-code`.
  `@veritio/claude-code` pins the other two with EXACT versions — bump all
  three plus those pins plus `bun.lock` in one release PR (see PR #16/#19 for
  the pattern). Publish order: core → storage → claude-code.
- **Framework adapters** (`@veritio/better-auth`, `next`, `tanstack-start`,
  `sveltekit`, `react`, `vue`, `svelte`) are published on their own 0.0.x
  cadence and declare `@veritio/core: ">=0.0.0"` as a PEER dependency — a core
  release does NOT require adapter bumps or republishing. Adapter README/doc
  changes only reach npmjs.com via an adapter republish.
- **Never published (do not wait on them in a release):** `@veritio/express`,
  `@veritio/hono`, `@veritio/trpc`, `server/node` (all `private: true`); the
  `veritio` CLI is not on npm yet.
- **Publishing:** run `npm publish` via a script file — the
  `.claude/hooks/guard-risky-commands.sh` hook blocks it in raw shell commands.
  Requires a short-lived npm token from the user (never stored). Run
  `bun run verify` before publishing and confirm each version with `npm view`
  afterward.
- **Merging:** gate on a FRESH `gh pr checks N --watch` before `gh pr merge N`;
  dependabot branches carry stale check results.
- **Sibling consumers:**
  - `veritio-cloud` links core via `file:../veritio/sdks/typescript` — always
    tracks the local checkout, nothing to bump on release.
  - `veritio-website` pins `@veritio/core` from npm. Check and bump it on every
    core release; subpath imports (e.g. `@veritio/core/risk-score`, needed for
    browser code) require `>=0.1.0`, so a stale exact pin is a silent build
    footgun.
