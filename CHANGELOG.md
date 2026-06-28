# Changelog

All notable changes to Veritio will be documented in this file.

Veritio is a pre-1.0 Apache-2.0 project. Early releases may change APIs while the protocol, SDKs, adapters, and storage contracts settle. Release notes should be explicit about migration steps and should avoid legal-compliance guarantees.

## [Unreleased]

### Added

- OSS hygiene scaffold for contribution workflow, security disclosure, GitHub issue templates, pull request review, and release checks.
- Shared protocol conformance fixtures for canonical JSON, event creation, redaction, event hashing, audit record hashing, and idempotency-key hashing across TypeScript, Python, and Go tests.
- Runner-neutral storage conformance tests for durable `AuditStore` adapters.
- Env-gated live storage conformance tests for Postgres-compatible stores, the Neon factory, MySQL, MariaDB, and MongoDB.
- Runnable Next.js App Router plus Better Auth reference example with server-owned tenant and actor context.
- Deterministic cross-language risk-signal scoring (`risk.ts` / `risk.py` / `risk.go`) with the `DEFAULT_RISK_POLICY` reference policy (`veritio.reference.v1`), pinned by `spec/conformance` fixtures. See `docs/risk-scoring.md`.
- `security.risk` assertion builders (`createSecurityRiskAssertion`, `buildSecurityRiskAssessedEvent`, `hashAssertionRecord`) and the `activity_episode` evidence entity type plus the `activity.episode.started` lifecycle event/template.
- `activityEpisodeId` threading: stamped on every session event by the recorder (parity with `metadata.sessionId`), captured per session by `@veritio/claude-code`, and surfaced on the Better Auth example agent-session UIs.
- Local server `recordAssertion` / `listAssertions`: stores a precomputed `security.risk` assertion verbatim and links it to its subject by a `based_on` edge (the server is a sink and never scores).

### Changed

- Storage package exports `@veritio/storage/conformance` for external database adapter checks.
- Postgres/Neon and MySQL/MariaDB example schemas now match the storage adapter column contract.
- **BREAKING:** removed `riskScore` from the session security context (Better Auth adapter `BetterAuthSessionSecurityContext`, and the TypeScript/Python/Go `SessionSecurityContext` templates). Hosts now record a structured `riskSignals` envelope that the SDK scores deterministically. Migration: replace the numeric `riskScore` on the security context with a `riskSignals` envelope on event metadata via `withRiskSignals` (`with_risk_signals` in Python, `WithRiskSignals` in Go).

### Fixed

- Nothing yet.

### Security

- Nothing yet.

## Release Note Guidelines

For each release, include:

- protocol, schema, canonical JSON, hash, idempotency, redaction, retention, or storage-ordering changes
- TypeScript, Python, and Go SDK compatibility notes
- adapter and storage helper changes
- package publishing notes for public packages
- migration steps for breaking or behavior-affecting changes
- security fixes or disclosure references when public

Use evidence-support language. Do not claim that a Veritio release provides legal advice or automatic compliance with any regulation or framework.
