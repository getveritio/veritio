# Changelog

All notable changes to Veritio will be documented in this file.

Veritio is a pre-1.0 Apache-2.0 project. Early releases may change APIs while the protocol, SDKs, adapters, and storage contracts settle. Release notes should be explicit about migration steps and should avoid legal-compliance guarantees.

## [Unreleased]

### Added

- OSS hygiene scaffold for contribution workflow, security disclosure, GitHub issue templates, pull request review, and release checks.
- Shared protocol conformance fixtures for canonical JSON, event creation, redaction, event hashing, audit record hashing, and idempotency-key hashing across TypeScript, Python, and Go tests.
- Runner-neutral storage conformance tests for durable `AuditStore` adapters.
- Runnable Next.js App Router plus Better Auth reference example with server-owned tenant and actor context.

### Changed

- Storage package exports `@veritio/storage/conformance` for external database adapter checks.

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
