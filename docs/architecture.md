# Veritio Architecture

## Principle

Veritio is protocol-first. SDKs and framework adapters emit the same event and evidence-edge shapes, storage adapters persist them, and server/UI modules query or export them.

## Layers

1. **Spec**
   - Language-neutral JSON schemas.
   - Canonical JSON and hashing rules.
   - Event categories, graph edge relations, lawful bases, data categories, and retention policies.

2. **SDKs**
   - TypeScript, Python, and Go helpers for event and graph-edge creation, redaction, canonicalization, and hash verification.
   - SDKs do not own storage credentials unless explicitly configured by the host application.

3. **Adapters**
   - Framework middleware for common action points.
   - Auth adapters for sign-in, sign-up, password, session, and organization events.
   - Data adapters for ORM and query-layer mutation evidence.

4. **Storage**
   - PostgreSQL/Neon, MySQL/MariaDB, and MongoDB are durable host-injected targets.
   - Redis support is a tenant-tip cache helper unless paired with a durable store.
   - Storage receives normalized events and writes append-only records with previous-hash links.

5. **Server**
   - Optional local and self-hosted ingestion and query API.
   - Provides Workbench routes, MCP JSON-RPC tools, graph query, verification,
     and export preview without a hosted account.

6. **UI**
   - Local Workbench surface for debugging event and graph evidence quality.
   - Accessible audit-log, consent-history, and DSAR surfaces remain future
     hosted/self-hosted product UI work.
   - Framework-specific wrappers should consume a shared UI/data contract.

## Integrity Model

Canonical JSON v1 sorts object keys recursively, preserves JSON `null`, omits unsupported `undefined` values where the host language has them, and emits UTF-8 JSON strings without HTML escaping.

Each persisted record stores:

- normalized event payload
- or a normalized evidence graph edge payload
- tenant-local sequence number
- previous record hash
- current record hash
- canonicalization version
- hash algorithm
- append timestamp
- tenant-scoped idempotency-key hash

Persisted record hashes use `sha256(veritio-json-v1(record without hash))`. Audit event hashes use `sha256(veritio-json-v1({ event, previousHash }))`; graph edge hashes use `sha256(veritio-json-v1({ edge, previousHash }))`. The tenant-scoped idempotency-key hash uses `sha256(tenantId + "\u0000" + idempotencyKey)`. If the host does not pass an idempotency key, SDK recorders use the event or edge id as the idempotency key. Verification recomputes each record envelope hash and validates tenant scope, hash algorithm, canonicalization version, per-tenant sequence, and previous-hash links to detect mutation, deletion, and reordering within a checked sequence.

## Local Workbench Loop

`veritio dev --mcp` starts a local HTTP server with:

- `POST /v1/events`
- `GET /v1/events?tenantId=...`
- `POST /v1/edges`
- `GET /v1/edges?tenantId=...`
- `GET /v1/graph?tenantId=...`
- `GET /v1/verify?tenantId=...`
- `POST /v1/exports/preview`
- `POST /v1/scenarios/integration`
- `POST /mcp`

The MCP handler exposes read tools by default and hides write tools unless the
CLI is started with `--allow-write-tools`.
