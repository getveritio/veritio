---
name: veritio-implement-feature
description: Implement Veritio SDK, protocol, adapter, server, docs, and example changes with protocol-first guardrails.
---

# Veritio Implement Feature

Use this when working in the Veritio repository on actionable implementation tasks.

## Workflow

1. Read root `AGENTS.md`, `CLAUDE.md`, and relevant docs/spec files.
2. Define verifiable success criteria.
3. Use tests first for behavior changes when a narrow seam exists.
4. Keep `spec/` as the language-neutral source of truth.
5. Keep TypeScript, Python, and Go SDKs semantically aligned.
6. Keep adapters thin and injected.
7. For server-side entity mutations, prefer the governed-action helper
   (`createGovernedActionDraft` / `create_governed_action_draft` /
   `CreateGovernedActionDraft`) over hand-wiring change/activity IDs,
   changed paths, and idempotency hashes.
8. Run the strongest feasible check, usually `bun run verify`.

## Guardrails

- No legal-compliance guarantees in product copy.
- No raw secrets or unnecessary personal data in event metadata.
- No framework-specific fields in the core event protocol.
- No hosted-provider requirement for OSS SDK usage.
- Record governed actions at the host application's server mutation boundary,
  not in browser form state or framework adapters.
