---
paths:
  - "sdks/**/*.{ts,py,go}"
  - "adapters/**/*.{ts,tsx}"
  - "server/**/*.{ts,tsx}"
  - "storage/**/*.{ts,py,go}"
  - "cli/**/*.{ts,py,go}"
---

# Lifecycle Semantics, Error Handling & Post-Success Effects

These rules apply across SDK core, adapters, server, storage, and CLI.

## Typed error mapping

- Catch blocks must translate only known, typed domain errors into typed results or status codes.
- Do not blanket-catch operational failures and relabel them as caller precondition issues.
- Do not echo arbitrary `error.message` values from unknown exceptions to callers, responses, or logs. Unexpected failures should bubble or be converted to sanitized errors.

## Integrity & fail-closed

- Fail closed when integrity fields are missing or unverifiable: absent or malformed event hash, previous hash, or canonical-JSON input must produce a typed error, never a silent success.
- Do not let missing, truncated, or malformed integrity data degrade into empty-success behavior. If the system cannot trust the result, fail closed with a typed/sanitized error or explicit degraded state.
- Redaction must run before any persistence or transport. A missing redaction step on a recorded event is a fail-closed condition, not a warning.

## Deterministic redaction

- Redaction and canonical serialization must be deterministic: same input yields the same bytes across runs and across languages.
- Do not introduce ordering, timestamps, locale, or environment dependence into canonical or redacted output.

## Idempotent storage writes

- Storage writes for the same event/hash must be idempotent. A retry must not duplicate rows or break the hash chain.
- Once the authoritative write has committed, follow-up audit/log/cache writes must be best-effort unless the code performs explicit compensation/rollback.
- Do not tell the caller a write failed after the authoritative record already committed; that creates partial-success confusion and retry hazards.
- Best-effort follow-up failures must log a sanitized warning with safe scope identifiers — never secrets, raw credentials, PII, or full error text.

## Async state guards

- Async follow-up work must not apply stale results over newer state. Before writing fetch/analysis results back into state, storage, or caches, compare a revision/content token or verify the target is unchanged.

## Lifecycle branch semantics

- Flows with multiple outcomes (record vs reject, store vs skip, verify-pass vs verify-fail) must define which state is retained vs removed for each branch before implementation.
- Verification-fail branches must not silently drop or mutate the original record.

## Tests

- Multi-branch flows need explicit regression coverage for each materially different branch when feasible.
- At minimum, cover:
  - integrity-present (success) vs integrity-missing (fail-closed)
  - idempotent retry of a storage write
  - deterministic redaction across repeated runs
  - success despite a best-effort post-write follow-up failure
