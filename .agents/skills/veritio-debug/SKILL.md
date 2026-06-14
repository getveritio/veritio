---
name: veritio-debug
description: Debug Veritio bugs, flakes, and cross-language divergence across TS/Python/Go with writer/reader/authority proof.
---

# Veritio Debug

Use this when investigating bugs, flakes, or any divergence that crosses languages, SDKs, adapters, server, or storage. The runtimes here are the languages: TypeScript, Python, and Go each produce and consume the same protocol artifacts.

## Workflow

1. Reproduce the failure and capture the exact value that mismatched (hash, canonical bytes, field name, omitted-field decision).
2. Read `spec/` as the authority both sides must match.
3. Build the writer/reader/authority map before proposing a fix.
4. Reproduce the failing value in both the writing and reading language.
5. Create an agent team for cross-language or cross-boundary bugs.

## Required Proof

- writer (which SDK/runtime produced the value)
- reader (which SDK/runtime consumed/verified it)
- authority (the `spec/` definition both sides must match)
- transport/format (canonical-JSON bytes, field order, encoding, hash input)
- state key (event id, previous hash, hash chain position)
- first boundary where expected and actual state diverge

## Verification

- `bun run test:ts`, `bun run test:python`, `bun run test:go`.
- `bun run verify` for meaningful changes.
- Include a negative check proving the old divergent boundary no longer diverges.
