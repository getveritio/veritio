# EvidenceCommit Hash Construction (normative)

This document specifies the byte-level hash construction for
`evidence.commit` records (`evidence-commit.schema.json`) so an independent
implementation can reproduce the exact digests without reading SDK source.
The reference implementations live in the TypeScript, Python, and Go SDKs and
are pinned to each other by `spec/conformance/evidence-commit.json`; where
this prose and the conformance fixture could ever disagree, the fixture wins.

All canonical serialization below is `veritio-json-v1` (recursively sorted
object keys, `undefined`/missing members omitted, UTF-8, no HTML escaping)
and all digests are SHA-256. EvidenceCommit digests are
**algorithm-qualified** strings of the form `sha256:<64 lowercase hex>`;
this deliberately differs from v1 audit/edge record envelope hashes, which
remain bare 64-hex.

## 1. Member manifest normalization

A commit's `members` array is normalized before any hashing:

1. The array must be non-empty.
2. Each member is reduced to exactly `{index, recordType, recordId,
   recordHash}`; unknown fields are stripped before hashing.
3. `index` must be a non-negative integer; `recordType` must be one of the
   supported physical record types (`audit.record`, `evidence.edge.record`,
   `entity.revision.record`, `activity.record`, `assertion.record`,
   `change.record`); `recordHash` must be algorithm-qualified
   (`sha256:<hex>`).
4. Members are sorted by ascending `index`; after sorting, indices must be
   contiguous from zero.
5. A duplicate physical identity (`recordType` + `recordId`) fails
   normalization; duplicates are never silently de-duplicated.

## 2. Leaf hash (domain `veritio-record-leaf-v1`)

Each normalized member becomes one Merkle leaf:

```
leaf = "sha256:" + sha256hex(canonicalJson({
  domain: "veritio-record-leaf-v1",
  index: member.index,
  recordType: member.recordType,
  recordId: member.recordId,
  recordHash: member.recordHash,
}))
```

The `domain` separator keeps leaf hashes distinct from every other digest in
the protocol even when the payload bytes coincide.

## 3. Merkle root (`treeAlgorithm: "veritio-merkle-v1"`, domain `veritio-merkle-node-v1`)

The `recordsRoot` is computed over the ordered leaves:

1. Start with `level = [leaf0, leaf1, …]` in member order.
2. While more than one hash remains, combine pairs left-to-right:

   ```
   node = "sha256:" + sha256hex(canonicalJson({
     domain: "veritio-merkle-node-v1",
     left:  level[i],
     right: level[i + 1] ?? level[i],   // ODD RULE: duplicate the final hash
   }))
   ```

   An odd level duplicates its final hash as its own right sibling — at every
   level, not only the leaf level.
3. The single remaining hash is `recordsRoot`. A one-member commit's
   `recordsRoot` is its leaf hash unchanged.

## 4. Commit hash (domain `veritio-commit-v1`)

The commit hash covers every commit field except `hash` itself:

```
hash = "sha256:" + sha256hex(canonicalJson({
  domain: "veritio-commit-v1",
  commit: { …commit fields, recordsRoot included, hash EXCLUDED… },
}))
```

`commit` here is the full record — `recordType`, `schemaVersion`, `commitId`,
`streamId`, `sequence`, `previousCommitHash`, normalized `members`,
`recordCount`, `recordsRoot`, `canonicalization`, `hashAlgorithm`,
`treeAlgorithm`, `committedAt` — canonicalized with sorted keys. The domain
marker keeps commit hashes separate from v1 record envelope hashes.

## 5. Chain linkage

Commit chains are per `streamId`: a valid chain starts at `sequence: 1` with
`previousCommitHash: null`, then each commit increments the sequence by one
and carries the previous commit's `hash`. Streams are independent; verifying
one stream never reads another's state.

## Verification scope (v1)

`verifyEvidenceCommits` (TS) / `verify_evidence_commits` (Python) /
`VerifyEvidenceCommits` (Go) prove the commit **ledger's** internal
consistency only: envelope algorithms, per-stream sequence and previous-hash
linkage, member-manifest shape, Merkle root, and commit hash. They
deliberately do **not** reconcile `member.recordHash` against independently
verified records — a fabricated commit chain over fabricated record hashes
verifies `ok` in isolation. Per-record integrity is proven separately by
`verifyAuditRecords` / `verifyEvidenceEdgeRecords`; end-to-end evidence
verification composes both, as the reference server's `verify()` does.
Commits scope claims to **ledger atomicity** ("these records were appended
together"), not record authenticity.
