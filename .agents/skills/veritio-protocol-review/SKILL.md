---
name: veritio-protocol-review
description: Review Veritio changes for event schema compatibility, canonical JSON/hash stability, SDK parity, and privacy-safe metadata.
---

# Veritio Protocol Review

Use this for reviews or changes involving:

- `spec/**`
- `sdks/typescript/**`
- `sdks/python/**`
- `sdks/go/**`
- event metadata, redaction, hashing, or retention semantics
- governed-action draft helpers, changed paths, idempotency hashes, or
  revision evidence

## Review Focus

- SDK field names match the JSON schema.
- Redaction behavior is deterministic.
- Hash-chain inputs are explicit and tested.
- TypeScript, Python, and Go stay aligned.
- Governed action helpers derive the same IDs, changed paths, idempotency hash,
  and outbox shape across languages.
- Examples avoid raw emails, secrets, tokens, and credentials unless demonstrating redaction.

## Verification

Run:

```bash
bun run verify
```
