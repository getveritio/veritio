---
name: veritio-implement-feature
description: >
  End-to-end Veritio workflow for SDK, protocol, adapter, server, docs, and example changes.
---

# Veritio Implement Feature

Use this for actionable work where the expected output is changed files, not only advice.

## Route

1. Read `CLAUDE.md`, `AGENTS.md`, relevant `.claude/rules/*`, and nearby docs/specs.
2. Define success criteria and the smallest useful verification command.
3. If behavior changes, write or update tests before implementation when a clear seam exists.
4. Keep protocol changes language-neutral and update SDK parity.
5. Keep adapters thin and injected; do not move protocol ownership into framework packages.
6. Run relevant checks, with `bun run verify` for meaningful repo changes.

## Required Coverage

- Event shape remains compatible with `spec/event.schema.json`.
- Redaction/minimization is preserved.
- TypeScript/Python/Go SDK parity is maintained or the gap is documented.
- Hosted-provider behavior remains optional.
- Product copy does not claim guaranteed legal compliance.

## Handoff

Report changed files, verification commands/results, and residual risk.
