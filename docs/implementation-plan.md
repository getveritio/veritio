# Veritio Initial Scaffold Implementation Plan

**Goal:** Create a standalone, protocol-first OSS project with a tested TypeScript SDK, initial Python and Go SDKs, language-neutral schema, docs, and adapter placeholders.

**Architecture:** The repository starts with a shared event contract and deterministic hashing semantics. SDKs implement event creation, safe metadata redaction, canonical JSON, and hash-chain verification without framework or storage lock-in.

**Tech Stack:** Bun, TypeScript, Python standard library, Go standard library, JSON Schema.

## Tasks

- [x] Create standalone folder outside the Relpin repository.
- [x] Add root monorepo metadata and project docs.
- [x] Add failing TypeScript, Python, and Go tests for core event behavior.
- [x] Implement TypeScript SDK core.
- [x] Implement Python SDK core.
- [x] Implement Go SDK core.
- [x] Add framework adapter package placeholders with explicit boundaries.
- [x] Run verification.
