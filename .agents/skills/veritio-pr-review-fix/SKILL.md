---
name: veritio-pr-review-fix
description: Address Veritio PR review feedback by verifying each finding against current code before patching.
---

# Veritio PR Review Fix

Use this when addressing external review comments or PR findings.

## Workflow

1. Fetch current PR comments/threads when the review is on GitHub.
2. Classify each finding as accepted, rejected/noise, or deferred hardening.
3. Verify each claim against current code and line numbers before patching.
4. Patch accepted findings with targeted tests where feasible.
5. Re-run focused checks (`bun run test:ts`, `test:python`, `test:go`, or `bun run verify`).

## Guardrails

- Do not blindly apply review suggestions.
- Preserve rejected findings with a short reason so the same noise does not reappear.
- For accepted bugs, encode prevention in tests, docs, scoped rules, or reviewer agents.
- For protocol/integrity/redaction findings, confirm the fix holds across TypeScript, Python, and Go.
