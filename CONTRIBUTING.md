# Contributing to Veritio

Thanks for helping improve Veritio.

Veritio is a young Apache-2.0 project for application-level evidence support: audit trails, consent history, records of processing, data subject workflows, retention, and exportable records. It is not legal advice and does not make an application automatically compliant with GDPR, EAA, SOC 2, HIPAA, DORA, NIS2, or any other framework.

## Project Principles

- Keep the protocol language-neutral. TypeScript, Python, and Go SDKs must preserve the same event semantics.
- Treat `spec/` as the source of truth for event and audit-record shape.
- Keep framework adapters thin. They should receive configured recorders, stores, tenant scope, and actor context from host applications.
- Avoid collecting unnecessary personal data by default.
- Make metadata redaction explicit, deterministic, and easy to audit.
- Preserve deterministic hashing, canonical JSON, idempotency keys, and storage ordering.
- Keep OSS modules usable without a hosted Veritio account or proprietary service.

## Ways to Contribute

- Report bugs in SDK behavior, adapter boundaries, storage integrity checks, or docs.
- Improve tests for canonical JSON, hash-chain verification, redaction, tenant scope, idempotency, and cross-SDK parity.
- Add examples that show host-injected configuration without leaking secrets or unnecessary personal data.
- Improve docs with accurate evidence-support language.
- Propose new adapters, storage helpers, or server APIs with a clear boundary from the core protocol.

Security issues should not be opened as public GitHub issues. See [SECURITY.md](SECURITY.md).

## Development Setup

Required tools:

- Bun `1.3.10`
- Python `3.12`
- Go, using the version declared by `sdks/go/go.mod`

Install dependencies:

```sh
bun install
```

Run the full verification gate:

```sh
bun run verify
```

Useful focused checks:

```sh
bun run test:ts
bun run test:python
bun run test:go
bun run test:storage
bun run test:adapters
bun run typecheck
```

## Change Workflow

1. Open or reference an issue for non-trivial changes.
2. Keep pull requests focused on one protocol, SDK, adapter, storage, server, docs, or release-hygiene topic.
3. Update tests or examples when behavior changes.
4. Update docs when public API, package names, install commands, release process, or product language changes.
5. Run the strongest feasible local verification before opening a PR. Prefer `bun run verify` unless the change is docs-only and you explain the narrower checks.
6. Fill out the pull request template honestly, including skipped checks and known follow-ups.

## Protocol and SDK Changes

For event schema, canonical JSON, hashing, redaction, retention, DSAR, records-of-processing, or audit-record changes:

- Update language-neutral docs or schemas first.
- Keep TypeScript, Python, and Go semantics aligned.
- Add or update parity vectors when behavior can diverge across languages.
- Avoid framework-specific fields in the core event model.
- Keep storage adapters fail-closed when required fields, tenant scope, or integrity data are missing.

## Adapter and Example Changes

Adapters and examples should:

- Run server-side for evidence recording unless a package is explicitly UI-only.
- Receive configured recorders and stores from the host application.
- Avoid reading secrets, database URLs, provider tokens, tenant scope, or actor context from browser code.
- Record only the metadata needed for the documented evidence purpose.
- Avoid making any framework adapter authoritative for the Veritio event model.

## Public Copy Guidelines

Use language like:

- evidence support
- audit trail
- tamper-evident records
- records of processing
- data subject workflow
- retention policy evidence

Avoid language like:

- guaranteed compliance
- automatic GDPR compliance
- makes your app compliant
- certified by Veritio
- provides legal advice

If a claim depends on a hosted provider feature, self-hosted server feature, or unreleased package, mark it as planned or keep it out of OSS package docs.

## Translations

The English `README.md` is the authoritative document. A Korean translation
lives at `README.ko.md` and may lag behind English. Community translations into
other languages (for example 中文 or 日本語) are welcome as PRs: follow the same
structure as `README.ko.md` — translate the stable top slice (intro, install,
quick start, Workbench) and link back to the English README for fast-moving
sections such as the package map and protocol invariants. Keep the "English is
authoritative" note at the top.

## License

By contributing, you agree that your contribution is licensed under the Apache License 2.0.
