---
name: veritio-protocol-change
description: >
  Use when changing Veritio event schemas, canonical JSON, hashing, redaction, retention, consent, DSAR, or records-of-processing contracts.
---

# Veritio Protocol Change

Protocol work must preserve cross-language clarity.

## Checklist

1. Start at `spec/event.schema.json` or the relevant spec file.
2. Update TypeScript, Python, and Go SDKs together when the core event contract changes.
3. Add equivalent tests in each affected SDK.
4. Update docs that show event examples.
5. Run `bun run verify`.

## Guardrails

- Do not add framework-specific fields to the core protocol.
- Do not add metadata that encourages personal data collection.
- If a breaking change is unavoidable, document migration notes before handoff.
