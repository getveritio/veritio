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
- Avoid vendor lock-in in OSS modules. Hosted-provider features belong behind optional clients or server modules.
- If a change affects event semantics, graph edges, canonical JSON, hashing, redaction, idempotency, or export manifests, update this OSS repo before hosted code.

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
