# Verify + Tamper Detection

Demonstrates the core Veritio integrity story in TypeScript: append hash-chained
audit records, verify the chain, and watch verification **fail closed** under
each realistic tampering class.

## What it shows

| Scenario | Result |
|---|---|
| Untampered export | `{ ok: true }` |
| Stored metadata edited after the fact | `{ ok: false, index, reason: "hash_mismatch" }` |
| Mid-chain record deleted (evidence suppression) | `{ ok: false, index, reason: "sequence_mismatch" }` |
| Records reordered (history rewrite) | `{ ok: false, index, reason: "sequence_mismatch" }` |
| EvidenceCommit member hash swapped | `{ ok: false, index, reason: "records_root_mismatch" }` |

`src/scenario.ts` records a small governed lifecycle through
`createAuditRecorder` + `MemoryAuditStore`, then verifies with
`verifyAuditRecords` and binds the records into an `EvidenceCommit`
(ordered Merkle manifest) verified with `verifyEvidenceCommits`.

The same `verifyAuditRecords` call works against records fetched from any
conforming `AuditStore` (`@veritio/storage` Postgres/Neon/MySQL/MariaDB/Mongo);
`MemoryAuditStore` keeps this example dependency-free.

## Run

```sh
bun install
bun test src
```

`verifyAuditRecords` / `verifyEvidenceEdgeRecords` are TypeScript-only today;
`verifyEvidenceCommits` has TypeScript, Python, and Go parity. Veritio supports
evidence collection and verification workflows; it is not legal advice.
