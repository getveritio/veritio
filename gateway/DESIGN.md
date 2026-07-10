# @veritio/gateway — Design

Reference: `spec/ai-gateway-capture.md` (normative event vocabulary) and the repo-level design
spec this package implements. This file maps modules to responsibilities for maintainers.

## Module map

| Module | Kind | Responsibility |
|---|---|---|
| `config.ts` | pure validation | `parseGatewayConfig`: fail-closed config parsing; cross-checks (key→policy, policy→provider); never echoes values (configs hold real provider keys) |
| `keys.ts` | pure | sha256 hashing of presented keys, header extraction (`x-api-key` then `Bearer`), resolution incl. revocation |
| `policy.ts` | pure | `decide(ctx, policy)`: allowlist decision table, first-failure-wins, deny-by-default; `matchesModel` exact/prefix/`"*"` |
| `usage.ts` | pure | provider-reported usage from JSON bodies and line-buffered SSE accumulation (Anthropic `message_start`/`message_delta`, OpenAI `include_usage` final frame) |
| `pricing.ts` | pure | integer micro-USD cost from a versioned catalog; unknown model → `null`, never a guess |
| `evidence.ts` | pure mapping + sink facade | `RequestOutcome` → `ai.request.*` event; the privacy chokepoint (type cannot carry bodies/keys); gap-marker builder |
| `proxy.ts` | handler | pipeline: health gate → key → policy → forward → tee-stream metering → exactly one outcome recorded |
| `health.ts` | state | block/degrade evidence-failure semantics, bounded retry queue, drop counting |
| `server.ts` | process boundary | the ONLY module reading files/env/signals; Bun server, `/healthz`, SIGHUP reload, retry loop |

## Request pipeline

```
client (official SDK, base_url swap, virtual key)
  → route map (POST /v1/messages | /v1/chat/completions; else 404, no evidence)
  → health gate (block mode: 503 while evidence store is down)
  → key resolution (sha256 lookup; unknown/revoked → 401 + ai.request.denied)
  → body buffer + model parse + optional request sha256
  → decide() (deny → 403 + ai.request.denied; upstream never contacted)
  → forward to pinned provider baseUrl with the real key
      (single permitted mutation: OpenAI stream_options.include_usage injection, recorded)
  → non-stream: buffer, extract usage, hash, respond verbatim
    stream: observed passthrough (NOT tee — an eagerly-read meter branch would
    buffer the whole response for slow clients); chunks hash/meter as the
    client pulls, so backpressure reaches the upstream connection
  → exactly one evidence outcome (completed/failed) with usage/cost/latency
```

## Invariants (tested)

- Bytes pass through untouched except the one recorded injection.
- Presented keys and provider keys never appear in evidence, logs, error bodies, or upstream
  requests (presented) / client responses (provider).
- Fail closed everywhere: unmapped path, unknown key, unparseable body, missing policy.
- Metadata keys avoid the core redaction pattern (`/token/i` etc.) — see the naming constraint
  in `spec/ai-gateway-capture.md`; regression: e2e chain test reads persisted (post-redaction)
  records.
- Evidence durability: block mode refuses traffic when the store is down; degrade mode records
  an `ai.gateway.evidence.gap` marker for dropped outcomes (drop counts are consumed only after
  the marker actually records). ONE health state outlives config reloads, so pending evidence
  and the fail-closed gate survive SIGHUP.
- Client abort cancels the upstream fetch and records `status: "aborted"`.

## Testing layout

- `src/*.test.ts` — pure-module unit tests + handler tests over an injected fake fetch
  (`test/harness.ts`), streaming fixtures under `test/fixtures/` (hand-authored from documented
  provider wire formats).
- `src/server.test.ts` — end-to-end over real HTTP: mock provider `Bun.serve` ↔ gateway,
  evidence JSONL on disk re-verified with `verifyAuditRecords`, SIGHUP-equivalent reload paths.
