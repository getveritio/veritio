# Veritio Architecture

## Principle

Veritio is protocol-first. SDKs and framework adapters emit the same event shape, storage adapters persist it, and server/UI modules query or export it.

## Layers

1. **Spec**
   - Language-neutral JSON schemas.
   - Canonical JSON and hashing rules.
   - Event categories, lawful bases, data categories, and retention policies.

2. **SDKs**
   - TypeScript, Python, and Go helpers for event creation, redaction, canonicalization, and hash verification.
   - SDKs do not own storage credentials unless explicitly configured by the host application.

3. **Adapters**
   - Framework middleware for common action points.
   - Auth adapters for sign-in, sign-up, password, session, and organization events.
   - Data adapters for ORM and query-layer mutation evidence.

4. **Storage**
   - Postgres is the first durable target.
   - Storage receives normalized events and writes append-only records with previous-hash links.

5. **Server**
   - Optional ingestion and query API.
   - Supports self-hosted and hosted-provider deployments.

6. **UI**
   - Accessible audit-log, consent-history, and DSAR surfaces.
   - Framework-specific wrappers should consume a shared UI/data contract.

## Integrity Model

Canonical JSON v1 sorts object keys recursively, preserves JSON `null`, omits unsupported `undefined` values where the host language has them, and emits UTF-8 JSON strings without HTML escaping.

Each persisted record stores:

- normalized event payload
- tenant-local sequence number
- previous record hash
- current record hash
- canonicalization version
- hash algorithm
- append timestamp
- tenant-scoped idempotency-key hash

Persisted record hashes use `sha256(veritio-json-v1(record without hash))`. The tenant-scoped idempotency-key hash uses `sha256(tenantId + "\u0000" + idempotencyKey)`. If the host does not pass an idempotency key, SDK recorders use the event id as the idempotency key. Verification recomputes each record envelope hash and validates tenant scope, hash algorithm, canonicalization version, per-tenant sequence, and previous-hash links to detect mutation, deletion, and reordering within a checked sequence.
