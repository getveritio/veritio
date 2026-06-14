---
paths:
  - "sdks/**/*.{ts,py,go}"
  - "adapters/**/*.{ts,tsx}"
  - "server/**/*.{ts,tsx}"
  - "storage/**/*.{ts,py,go}"
  - "cli/**/*.{ts,py,go}"
  - "spec/**/*"
  - "docs/**/*.{md,mdx}"
---

# Debugging & Authority Proof

Use this rule for bugs, regressions, flakes, and any divergence that crosses languages, SDKs, adapters, server, storage, or the protocol spec. In this repo "multi-runtime" means multi-language: TypeScript, Python, and Go each produce and consume the same protocol artifacts.

## Root-cause standard

- Do not propose a fix until you can name the first boundary where expected and actual state diverge.
- Logs describe symptoms. Code paths, captured bytes, test fixtures, and file:line evidence prove causes.
- Start from the typed failure contract: error type, message, phase, and the exact value that mismatched (hash, canonical bytes, field name, omitted-field decision) before interpreting generic log text.
- When subagents or plugins agree on a conclusion, still test the strongest shared assumption. Parallel agreement can share the same blind spot.

## Authority map

For any cross-language or cross-module divergence, build this map before fixing:

| State | Writer | Reader | Transport/format | Key/scope | Evidence |
|---|---|---|---|---|---|

The "writer" is whichever SDK/runtime produced the value; the "reader" is whichever consumes it. The "format" is the canonical-JSON byte layout, field ordering, encoding, or hash input definition that both sides must agree on.

## Required checks

- For a canonical-JSON or hash divergence across TS/Python/Go, prove which SDK produced the canonical form and which one verified it. Capture the exact bytes each side computed, not a summary.
- Compare the documented hash input (`spec/`) against what each SDK actually feeds the hash function. A field-order, encoding, or omitted-field mismatch is a divergence, not a coincidence.
- If a value crosses a language boundary (recorded in one SDK, verified in another), reproduce the failing value in both languages before changing either.
- If the failure happens after a "successful" preparatory step (e.g. redaction ran, then hashing failed), prove the next boundary before changing the preparatory step.
- Confirm the spec is the authority. If two SDKs disagree, the one that diverges from `spec/` is wrong unless the spec itself is being changed deliberately.

## Handoff

Report the root cause as:

```text
Expected state:
Actual state:
First divergent boundary:
Evidence:
Fix:
Regression proof:
```
