---
name: veritio-debug
description: >
  Veritio wrapper for bugs, flakes, and cross-language divergence. Routes to global
  systematic debugging plus writer/reader/authority proof across TS/Python/Go.
---

# Veritio Debug

Use this for bugs, flakes, and any divergence that crosses languages, SDKs, adapters, server, or storage. In this repo the runtimes are the languages: TypeScript, Python, and Go each produce and consume the same protocol artifacts.

## Route

1. Use `superpowers:systematic-debugging`.
2. Apply the writer/reader/authority proof below and inspect `spec/` plus the closest scoped `CLAUDE.md`/`AGENTS.md`.
3. Create an agent team for cross-language or cross-boundary bugs. Give teammates competing hypotheses and one devil's-advocate reviewer.
4. Use plain subagents only for tiny isolated evidence reads, or when `TeamCreate` is unavailable; record the skip reason.

## Required Proof

Before proposing a fix, identify:
- writer (which SDK/runtime produced the divergent value)
- reader (which SDK/runtime consumed/verified it)
- authority (the `spec/` definition both sides must match)
- transport/format (canonical-JSON bytes, field order, encoding, hash input)
- state key (event id, previous hash, hash chain position)
- first boundary where expected and actual state diverge

## Verification

- Capture the exact bytes/hash each language computed, not a summary.
- Reproduce the failing value in both the writing and reading language.
- Verify with `bun run test:ts`, `bun run test:python`, `bun run test:go`, and `bun run verify` for meaningful changes.
- Include a negative check proving the old divergent boundary no longer diverges.
