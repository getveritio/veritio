---
paths:
  - "sdks/**/*"
  - "adapters/**/*"
  - "server/**/*"
  - "storage/**/*"
  - "cli/**/*"
  - "examples/**/*"
  - "spec/**/*"
---

# File Organization

Keep structure predictable. Match the closest existing pattern before inventing a new one.

## SDK Layout

`sdks/{typescript,python,go}/` mirror the same protocol concerns in each language:

- One module per core concern: event creation, canonical JSON, hashing, hash-chain verification, redaction.
- Keep the public surface behind a clear entry point (`src/index.ts`, package `__init__.py`, package root in Go).
- Shared protocol field names come from `spec/`; do not re-derive them per SDK.
- Tests live beside or under the language's conventional test location and cover the same behavior across languages.

## Adapter Layout

- `adapters/<framework>/` holds framework-specific translation only.
- Adapters receive configured recorders/clients from the host app; they do not own protocol semantics.
- Keep framework wiring (middleware, hooks, route handlers) separate from any small translation helpers.

## Server / Storage / CLI Layout

- `server/` splits by route/handler or domain; environment-derived config is read at process-boundary modules only.
- `storage/` keeps each driver's wiring separate from query/serialization logic; storage adapters never receive credentials in browser-visible code.
- `cli/` keeps one module per command; shared helpers live in a clearly named support module, not a junk drawer.

## Spec Layout

- `spec/` is the protocol source of truth. Group schemas by domain.
- Spec changes drive SDK changes, not the reverse.

## Naming

- Directories and files: language-conventional (`kebab-case` for TS/dirs, `snake_case` for Python, Go package conventions).
- Tests: `<name>.test.ts`, `test_<name>.py`, `<name>_test.go`.

## Anti-Patterns

- God files that mix event construction, canonical serialization, hashing, and redaction.
- Junk drawers such as broad `utils/`, `helpers/`, or `misc/` directories.
- Protocol logic copied into adapters instead of consumed from an SDK.
- Storage or provider credentials living in adapter or example code.
- Drift between SDKs in module boundaries for the same protocol concern.
