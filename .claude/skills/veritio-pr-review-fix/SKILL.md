---
name: veritio-pr-review-fix
description: >
  Veritio wrapper for CodeRabbit, Codex, or human PR review feedback. Verifies findings
  against current code before patching.
---

# Veritio PR Review Fix

Use this when addressing external review comments or PR findings.

## Route

1. Use `superpowers:receiving-code-review`.
2. Fetch current PR comments/threads when the review is on GitHub.
3. Classify each finding as accepted, rejected/noise, or deferred hardening.
4. Patch accepted findings with targeted tests where feasible.
5. Re-run the relevant focused checks (`bun run test:ts`, `test:python`, `test:go`, or `bun run verify`).

## Rules

- Do not blindly apply review suggestions.
- Verify each claim against current code and line numbers before patching.
- Preserve rejected findings with a short reason so the same noise does not reappear.
- For accepted bugs, encode prevention in tests, docs, scoped `.claude/rules/*`, or reviewer agents when feasible.
- For protocol/integrity/redaction findings, confirm the fix holds across TypeScript, Python, and Go.
