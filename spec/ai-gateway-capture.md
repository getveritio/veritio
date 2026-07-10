# AI Gateway Capture Vocabulary (normative)

This document freezes the event vocabulary an AI gateway implementation emits into a Veritio
evidence chain. It is language-neutral: any gateway implementation (the reference TypeScript
`@veritio/gateway`, or a future port) MUST reproduce these shapes exactly. It introduces **no
event-schema changes** — every event below is a plain `spec/event.schema.json` audit event whose
`action` names and `metadata` keys follow this contract. Conformance is: emitted events validate
against the event schema, chains verify with the standard record verifier, and metadata contains
no keys beyond the tables here.

A "gateway" here is a transparent proxy in front of AI provider APIs (Anthropic, OpenAI) that
enforces virtual-key + allowlist policy and records request outcomes. It records **metadata and
sha256 content hashes only — never prompt or response bodies, never presented or provider keys**.

## Actions

| Action | When |
|---|---|
| `ai.request.completed` | The provider responded (any 2xx, including a stream consumed to its end) |
| `ai.request.denied` | The gateway refused locally: unknown/revoked key, policy deny, unparseable body. Nothing was forwarded upstream |
| `ai.request.failed` | Upstream/provider or network failure, non-2xx upstream status, timeout, or client abort |
| `ai.gateway.evidence.gap` | Degrade-mode marker after an evidence-store outage overflowed the bounded retry queue |

## Event field mapping (`ai.request.*`)

| Field | Value |
|---|---|
| `actor` | `{ "type": "service", "id": <keyId> }` — the calling workload identified by its virtual key; literal id `"unknown"` when no key resolved |
| `target` | `{ "type": "model", "id": "<provider>:<model>" }` when the model is known, else `{ "type": "provider", "id": "<provider>" }` |
| `requestId` | Gateway-generated id, unique per request (top-level protocol field) |
| `occurredAt` | Request start time, ISO-8601 UTC |
| `scope.tenantId` | From gateway deployment config (one tenant per deployment) |

## Metadata keys (`ai.request.*`)

All values are non-PII. A key is either present with the stated type or absent — absence means
"not applicable / provider did not report", never zero.

| Key | Type | Presence |
|---|---|---|
| `gatewayId` | string | always |
| `provider` | `"anthropic" \| "openai"` | always |
| `endpoint` | `"messages" \| "chat-completions"` | when the path mapped to a known endpoint |
| `model` | string | when parseable from the request body |
| `stream` | boolean | always |
| `status` | integer HTTP status, gateway-assigned status for local denials, or the string `"aborted"` | always |
| `latencyMs` | integer | always |
| `policyDecision` | `"allow" \| "deny"` | always |
| `denyReason` | string (`unknown_key`, `revoked_key`, `missing_policy`, `provider_not_allowed`, `model_not_allowed`, `endpoint_not_allowed`, `unparseable_body`) | denied outcomes only |
| `usage` | `{ "input": int, "output": int }` provider-reported token counts | when the provider reported usage |
| `costBasis` | literal `"provider_reported"` | iff `usage` present |
| `costMicroUsd` | integer micro-USD | when `usage` present AND the model is in the deployment's pricing catalog |
| `requestBodyHash` | sha256 hex of the exact request body bytes | when content hashing is enabled |
| `responseBodyHash` | sha256 hex of the exact response body bytes | when content hashing is enabled and a body completed |
| `mutatedRequest` | literal `"inject_stream_usage"` | only when the gateway injected `stream_options.include_usage` into an OpenAI streaming request (the single permitted request mutation, config-gated) |

**Naming constraint (normative):** metadata keys MUST NOT match the core redaction pattern
(`/(password|secret|token|api[_-]?key|authorization|email|phone|ssn)/i`). This is why token counts
nest under `usage.input`/`usage.output` instead of `inputTokens` — a key containing "token" would
be deterministically redacted to `"[redacted]"` at event creation.

## Metadata keys (`ai.gateway.evidence.gap`)

| Key | Type | Presence |
|---|---|---|
| `gatewayId` | string | always |
| `droppedOutcomes` | integer > 0 | always |

Actor/target for the gap marker: `{ "type": "system", "id": <gatewayId> }` /
`{ "type": "gateway", "id": <gatewayId> }`.

## Fail-closed rules (normative)

1. **Deny-by-default routing.** Only mapped provider paths are proxied; anything else is refused
   without upstream contact. Unknown key, revoked key, missing policy, and unparseable request
   body are denies, never pass-throughs.
2. **No content, ever.** Prompt/response bodies, presented keys, provider keys, and raw header
   values must not appear in any event field. Content is representable only as sha256 hashes.
3. **One event per request outcome.** Every request that passes the health gate produces exactly
   one `ai.request.*` event; denied requests never additionally record a completed/failed event.
4. **Evidence-first availability.** In the default (block) failure mode, a gateway that cannot
   persist evidence refuses new traffic rather than serving unevidenced requests.
