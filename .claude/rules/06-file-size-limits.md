---
paths:
  - "sdks/**/*.{ts,py,go}"
  - "adapters/**/*.{ts,tsx}"
  - "server/**/*.{ts,tsx}"
  - "storage/**/*.{ts,py,go}"
  - "cli/**/*.{ts,py,go}"
  - "examples/**/*.{ts,tsx,js,jsx,svelte,vue,py,go}"
---

# File Size Limits

Keep files focused. Existing over-limit files are tech debt; do not make them larger unless a split would be more harmful than the extra lines.

| Category | Soft | Hard | If exceeded |
|---|---:|---:|---|
| SDK module (`sdks/**`) | 300 | 500 | split by concern (event, canonical JSON, hashing, redaction) |
| Adapter (`adapters/**`) | 200 | 400 | extract framework wiring vs translation helpers |
| Server module (`server/**`) | 300 | 500 | split by route/handler or domain |
| Storage adapter (`storage/**`) | 300 | 500 | split driver wiring vs query/serialization helpers |
| CLI command (`cli/**`) | 250 | 450 | extract per-command modules |
| Schema (`spec/**`) | 300 | 500 | group by domain or split shared definitions |
| Tests | 500 | 800 | split by scenario or feature |
| Examples (`examples/**`) | 300 | 500 | keep each example minimal and single-purpose |
| Generated/template files | exempt | exempt | keep generators small |

All non-blank, non-comment lines count. Imports count.

When touching an over-limit file, prefer extracting one cohesive block that serves the current change. Do not perform unrelated size cleanup.
