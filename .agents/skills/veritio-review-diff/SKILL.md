---
name: veritio-review-diff
description: >
  Diff-aware review workflow for Veritio changes, focused on bugs, SDK parity, protocol drift, redaction, and adapter boundaries.
---

# Veritio Review Diff

Use this before handoff on non-trivial diffs.

## Procedure

1. Inspect `git diff --stat`, `git diff`, and `git diff --cached`.
2. Route checks:
   - `spec/**` or SDK event types: protocol compatibility.
   - `sdks/**`: SDK parity, including governed-action helper parity.
   - `adapters/**` or `server/**`: adapter/server boundary; governed CRUD
     belongs in host mutation code, not adapters.
   - docs/product copy: compliance claim safety.
3. Lead with findings ordered by severity and include file/line evidence.
4. If clean, say so and list remaining test gaps.

## Verification

Prefer:

```bash
bun run verify
```
