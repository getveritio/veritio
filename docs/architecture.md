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

Each persisted record stores:

- normalized event payload
- previous record hash
- current record hash
- canonicalization version
- hash algorithm
- append timestamp

Verification recomputes the chain from canonical event payloads and detects mutation, deletion, and reordering within a checked sequence.
