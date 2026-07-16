# Provenance Recorder Identity Derivation (normative)

This document pins how the provenance recorder derives event and edge ids, so
hosted read models and downstream stores can key on the id format and so a
Python or Go recorder (currently a parity TODO) reproduces the same ids
byte-for-byte. The reference implementation is the TypeScript recorder
(`sdks/typescript/src/provenance.ts`), pinned by
`spec/conformance/provenance-ids.json`; where prose and fixture could ever
disagree, the fixture wins.

Ids are identity strings, not hashes: they feed the per-tenant idempotency key
(`hashIdempotencyKey(tenantId, id)`), so two records that must be distinct
occurrences MUST derive distinct ids, and a byte-identical replay of the same
record MUST derive the identical id.

## 1. Edge ids

Two derivations exist, chosen by whether the edge is written by a record method
(occurrence-scoped) or by `link()` (caller-intentional singleton):

- **Occurrence-scoped (record methods).** Every edge emitted by a record method
  (`recordPrompt`, `recordToolCall`, `recordFileChange`, …) is scoped by the id
  of its OWNING EVENT:

  ```
  edge_<ownerEventId>__<fromType>:<fromId>__<relation>__<toType>:<toId>
  ```

  Rationale: endpoint-only ids collided on the store idempotency key whenever
  the same logical link recurred with different bytes — e.g. one session
  modifying the same file again in a later turn produced the same edge id with
  a new `occurredAt`/`afterHash`, and the whole later batch was rejected.
  Owner-event scoping gives each occurrence its own edge while keeping replays
  of the identical record byte-identical, because owning event ids are
  themselves deterministic per record (§2).

- **Singleton (`link()`).** A deliberate graph assertion between two entities
  keeps the endpoint-only id, so re-linking the same pair replays idempotently:

  ```
  edge_<fromType>:<fromId>__<relation>__<toType>:<toId>
  ```

Entity references contribute exactly `<type>:<id>`; other entity fields (e.g.
`pathHash`) never participate in the id.

## 2. Event ids

Record methods accept a caller-supplied `id` verbatim; when absent they derive:

- **Prompt events.**

  ```
  evt_prompt__<sessionId>__<promptHash>[__<occurredAtUtcIso>]
  ```

  The suffix is present exactly when the caller supplied `occurredAt`, and is
  the ECMAScript `Date.toISOString()` normalization of that instant: UTC,
  millisecond precision, `Z` designator (`2026-07-16T10:00:00.000Z`). Offset
  inputs that name the same instant therefore produce the same id, and the
  same prompt text submitted twice at different times produces two occurrences
  instead of an idempotency-key collision.

- **Tool events.** `evt_tool__<toolCallId>` — the caller's tool-call id is the
  occurrence identity.

- **File-change events.** `evt_filechange__<sourceTreeId>__<resultVersion>`,
  with the literal `x` in place of an absent `resultVersion`.

## 3. Compatibility

- These derivations are normative as of `@veritio/core` 0.4.2. Earlier
  releases used endpoint-only ids for record-method edges and constant
  `(sessionId, promptHash)` prompt ids; stores may contain both generations.
  Consumers MUST treat ids as opaque identity strings and MUST NOT parse
  structure out of them beyond prefix classification (`evt_`, `edge_`).
- Changing any derivation is a protocol change: update this document, the
  conformance fixture, and every SDK recorder together.
