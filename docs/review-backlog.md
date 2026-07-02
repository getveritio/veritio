# Evidence-provenance review backlog

Verified follow-ups from the multi-lens adversarial review of the
evidence-provenance-fabric work (PRs #10/#11) and the cloud surfaces (#23).
Each item was confirmed against `main` by a verification agent; the **fixed**
items below already landed (see `fix/review-backlog`). The remaining items are
deferred deliberately — they are protocol-coupled, cross-repo, or design
decisions that deserve a coordinated `veritio-protocol-change` /
`split-orchestrator` cycle rather than a post-deploy drive-by.

> Reviewer output is critique, not truth. Re-verify each item against current
> code before patching (repo policy).

## Landed (this pass)

- **K — scoped-key revoke TOCTOU** (`veritio-cloud`): the revoke `UPDATE` now
  carries an `isNull(revoked_at)` guard and returns the existing row on a
  0-row race, so a concurrent double-revoke can no longer overwrite the original
  timestamp or write a duplicate `scoped_key.revoked` audit row.
- **J — outbox poison-pill** (`storage`): a non-retryable ingest verdict
  (`4xx`/`409`, `IngestError.retryable === false`) now dead-letters the row to a
  terminal `dead` status instead of looping forever; transient `5xx` and
  unexpected throws stay `pending`.
- **F — unbounded `lastError`** (`storage`): `errorMessage()` now persists a
  bounded (≤256-char), whitespace-collapsed `name: message` summary, never the
  raw unbounded `error.message`.
- **B — fabricated synthetic parent** (`sdks/{ts,py,go}`): the governed-change
  builder no longer invents `rev_<type>_<id>_previous`. A parent revision, the
  `derived_from` edge, and `outboxEntry.expectedParentRevisionRef` are emitted
  **only** when the caller supplies a real `expectedParentRevisionRef`; an update
  without one leaves lineage open for the host store. This changes the hashed
  `entity.revision.created` metadata (`veritio.revision.parents` is now `[]`
  instead of `[synthetic]`) byte-identically across all three SDKs — a deliberate,
  correct hash change since the placeholder was never valid.
- **riskScore ad-hoc field replaced** (`sdks/{ts,py,go}`, `adapters/better-auth`,
  examples): the numeric `riskScore` on the session security context was removed
  (breaking) and replaced by the deterministic `riskSignals` model — normalized,
  scored byte-identically across languages by the SDK risk module
  (`veritio.reference.v1`) — plus the `security.risk` assertion path
  (`recordType: assertion.recorded`, linked by `based_on` edges). The local
  server stores assertions as a sink and never scores. Remaining cross-language
  parity TODO: the `activityEpisodeId` recorder stamp and any Python/Go
  agent-capture adapter are tracked under `.claude/rules/02-sdk-parity.md`.

## Deferred — protocol-change / cross-repo cycle

### C — revision id collides on rollback to an identical earlier state
- **Status:** STOPGAP LANDED (`fix/review-backlog-deferred`): the revision id
  is now `rev_<type>_<id>_<digest12>_<sha256(changeId)8>` byte-identically
  across TS/Python/Go, pinned by `spec/conformance/governed-revision-id.json`
  (+ rollback-distinctness tests in all three SDKs). Verified that the cloud
  read models consume `revision.ref.id` as an opaque map key (never parsed),
  so the format change is transparent to Explain/timeline/diff. REMAINING
  OPEN: the spec's host-assigned ordinal design (`rev_..._18` + `ordinal`)
  is still the target; the id changes again when hosts assign ordinals.
- **Original finding (for context):** confirmed across TS/Python/Go.
- **Where:** `sdks/typescript/src/governed-change.ts` (`rev_<type>_<id>_<digest12>`),
  Python `governed_change.py`, Go `governed_change.go` (same scheme); consumers
  `veritio-cloud/src/cloud/governed-changes.server.ts` + `src/evidence/governed-changes.ts`
  key Explain/timeline/diff nodes on `revision.ref.id`.
- **Problem:** the revision id is content-addressed by the state-commitment
  digest only. A rollback `A → B → A'` that restores `A`'s exact governed state
  yields `A' == A`'s id, merging two distinct revisions into one Explain node
  (and a `B ↔ A` self-cycle). The design spec's intended shape is an **ordinal**
  suffix (`rev_..._18` + a separate `ordinal`), not the digest.
- **Why deferred:** the fix changes **every** revision id string and the cloud
  read models that key on it; the "right" scheme (host-assigned ordinals) is a
  design decision the SDK draft-builder can't make alone. Needs a conformance
  vector (`spec/conformance/governed-revision-id.json`) + coordinated cloud
  read-model/test updates.
- **Options:** (a) spec-aligned ordinal suffix (host-assigned — architectural);
  (b) stopgap: append `sha256(change.id)[:8]` to the id (replay-stable, but still
  diverges from the spec's ordinal target). Decide deliberately.

### lineagePolicy is a declared-but-unenforced knob
- **Status:** RESOLVED as documented-reserved (`fix/review-backlog-deferred`):
  the field is now explicitly documented as RESERVED / not-yet-enforced in all
  three SDKs, with enforcement tied to the host-assigned ordinal design (C).
  Kept (not removed) so hosts can record intent without a schema change later.
- **Original finding (for context):** `GovernedEntityDefinition.lineagePolicy`
  ('linear' | 'dag') is declared in all SDKs + the design spec but never read.
- **Action:** either honor it (host-side OCC enforcement, tied to C) or document
  it as reserved/not-yet-enforced. Removal touches public API in 3 languages +
  the spec example — do it as a deliberate decision, not a silent drop.

## Deferred — documentation / low-risk parity

### E — EvidenceCommit hash construction has no prose spec
- **Status:** LANDED (`fix/review-backlog-deferred`): normative
  `spec/evidence-commit-hashing.md` (manifest normalization, leaf/node/commit
  domain separators, odd-leaf rule, chain linkage), transcribed from the SDK
  sources; the conformance fixture stays the tie-breaker.
- **Original finding (for context):** confirmed. The algorithm (leaf separator `veritio-record-leaf-v1`,
  node separator `veritio-merkle-node-v1`, commit separator `veritio-commit-v1`,
  Merkle odd-leaf rule, canonical input) lives ONLY in SDK source
  (`sdks/typescript/src/index.ts:953/971/473`, Python `event.py:379/389/209`,
  Go `event.go:694/713/522`) + the `spec/conformance/evidence-commit.json`
  fixture. No committed prose lets an independent implementer reproduce the bytes.
- **Action:** add a normative `EvidenceCommit hash construction` section in
  `spec/` (next to `evidence-commit.schema.json`). Doc-only, but transcribe the
  algorithm carefully from the SDK source + verify against the fixture.

### A — EvidenceCommit verification is scoped to ledger atomicity (document the boundary)
- **Status:** LANDED (`fix/review-backlog-deferred`): "Verification scope
  (v1)" section in `spec/evidence-commit-hashing.md` + tightened
  `verifyEvidenceCommits` doc-comments in all three SDKs. The optional
  membership reconciliation in the composed `verify()` remains a future nicety.
- **Original finding (for context):** confirmed-as-intended, not a bug. `verifyEvidenceCommits`
  (`index.ts:484`, `event.py:212`, `event.go:550`) checks only the commit chain's
  internal consistency and never reconciles `member.recordHash` against the
  actually-verified records, so a fabricated chain verifies `ok` in isolation.
  Per-record integrity is covered by `verifyAuditRecords` /
  `verifyEvidenceEdgeRecords` in the composed `server/node` `verify()` path, and
  the design spec scopes commits to ledger atomicity.
- **Action:** add a "Verification scope (v1)" note in the spec + tighten the
  `verifyEvidenceCommits` doc-comments in all 3 SDKs so the boundary is explicit.
  Optionally add a cheap membership reconciliation in the composed `verify()`.

### I — CaptureMode advertises 8 modes, only 4 implemented (fails closed)
- **Status:** LANDED (`fix/review-backlog-deferred`): implemented-vs-reserved
  modes documented on `CaptureMode` (TS), `EntityFieldPolicy.Capture` (Go),
  and the `define_entity` docstring (Python). Type kept wide deliberately.
- **Original finding (for context):** partly-confirmed. `CaptureMode` advertises 8 modes; the
  state-commitment builder implements 4 (`omit`, `full`, `keyed_digest`,
  `content_digest`) and the other 4 (`randomized_digest`, `reference`, `redact`,
  `encrypt`) `throw`/error (fail closed — no silent weak commitment).
- **Action:** document which modes are implemented vs fail-closed in the
  `CaptureMode` doc-comment (3 SDKs), or narrow the public type to the supported
  set. No data-leak risk today.

### H — `verifyEvidenceCommits` defensive validation is uneven across SDKs
- **Status:** LANDED (`fix/review-backlog-deferred`): TS gained the
  streamId/hash type guards (Python parity, with tests); Go gained the empty
  streamId guard (its type system already rules out a non-string hash).
- **Original finding (for context):** partly-confirmed, cosmetic. Python has two extra type guards
  (`streamId`/`hash` are strings → `invalid_member_manifest`/`hash_mismatch`)
  that TS/Go lack; every other branch matches.
- **Action:** add the two guards to TS + Go for parity (low priority).

### G — Go `redactAny` default stringifies unsupported types (pre-existing)
- **Status:** the concerning sub-claims are refuted. `event.go:811` mirrors the
  TS `String(value)` / Python `str(value)` fallbacks, and no new
  digest-envelope/governed-change path reaches it.
- **Action:** none required; keep the parity note here for the record.

## Refuted (no action)

- **D — captureMethod hardcoded:** refuted. The reviewer's claim that
  `captureMethod` mis-asserts a guarantee did not hold against the actual code.
