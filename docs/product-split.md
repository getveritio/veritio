# Veritio Product Split

Veritio is split into three repositories so the OSS trust layer, public website,
and hosted commercial product do not blur into one another.

## Repositories

```txt
veritio/          public OSS protocol, SDKs, adapters, storage, self-hosted server
veritio-website/  public Astro website and documentation
veritio-cloud/    private TanStack Start SaaS/PaaS implementation
```

Each repository has two routing docs:

- `docs/repo-map.md`: shared sibling map and cross-repo routing order
- `docs/repository-spec.md`: repo-specific ownership, folder responsibilities,
  handoff rules, and verification

`veritio` is also the default Codex control repo for cross-repo work. It may
hold orchestration docs, prompts, scripts, and project-scoped agents so one
Codex session can coordinate sibling repos without turning the split into a
source monorepo.

## `veritio`

This repository is the portable evidence foundation. It must be useful without a
hosted Veritio account.

It owns:

- language-neutral specs
- TypeScript, Python, and Go SDKs
- framework adapters
- deterministic canonical JSON, hashing, redaction, and idempotency semantics
- host-injected storage helpers
- self-hosted server modules
- local Workbench and local MCP server when implemented
- verifier
- export bundle format
- conformance fixtures and examples

It must not require:

- hosted account creation
- hosted project ids
- hosted API keys
- hosted billing
- proprietary storage
- hosted-only event fields

## `veritio-website`

This repository is the public website and documentation surface for
getveritio.com.

It owns:

- marketing pages
- public docs
- public examples
- SEO metadata
- static assets
- public product education

It must not contain private hosted implementation code or unpublished operational
details.

## `veritio-cloud`

This repository is the private commercial SaaS/PaaS implementation.

It owns:

- hosted ingest API
- hosted MCP endpoint
- hosted Workbench
- scoped key management
- organization, project, role, and billing management
- graph projection jobs
- policy drift jobs
- export workers
- customer portals
- regional storage and operational service commitments

It must not define protocol semantics. If a hosted feature needs a new event
field, graph edge, hash rule, redaction rule, or export manifest field, the
public OSS repo must define it first.

## Boundary Rule

Protocol semantics belong in `veritio`.

Public claims belong in `veritio-website`.

Hosted operations belong in `veritio-cloud`.
