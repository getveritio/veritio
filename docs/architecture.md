# Veritio Architecture

Veritio is protocol-first. The event and edge schemas define portable evidence
payloads; SDKs normalize and hash those payloads; adapters translate host
framework behavior into protocol inputs; storage modules persist append-only
records; local server and CLI modules query, verify, preview exports, and expose
MCP tools.

Veritio supports evidence collection and verification workflows. It is not legal
advice and does not make an application automatically compliant with any
regulation or framework.

## Layers

1. **Protocol**
   - `spec/event.schema.json` defines the audit event payload.
   - `spec/edge.schema.json` defines evidence graph edge payloads.
   - `spec/audit-record.schema.json` and `spec/edge-record.schema.json` define
     append-only storage envelopes.
   - `spec/conformance/` holds cross-language vectors for canonical JSON,
     hashing, redaction, event creation, edge creation, and record hashing.

2. **SDKs**
   - TypeScript, Python, and Go SDKs create normalized events and edges, redact
     metadata, canonicalize JSON, hash payloads, and verify record chains where
     implemented.
   - Core SDKs do not read process environment variables, framework globals, or
     storage credentials.
   - TypeScript currently has higher-level runtime helpers such as
     `MemoryAuditStore`, chain verification helpers, audit templates, and the
     TS-only provenance recorder.

3. **Adapters**
   - Server-side adapters translate host context into actor, target, scope,
     request ID, and metadata inputs.
   - Better Auth, Next.js, TanStack Start, and SvelteKit adapters record only
     through injected Veritio recorders.
   - React, Vue, and Svelte packages are UI intent helpers. They annotate UI
     intent and must not record audit events from the browser.
   - Claude Code capture is an agent adapter: hooks write redacted local evidence
     and a read-only MCP server queries or exports that local store.

4. **Storage**
   - SQL and Mongo helpers persist tenant-scoped append-only audit record
     chains. Hosts inject transaction-capable clients and own credentials.
   - Redis is a validated tenant-tip cache helper, not a durable audit store.
   - `createFileEvidenceStore` persists local event and edge JSONL chains for
     hook-driven agent provenance and reference MCP workflows.
   - `@veritio/storage/conformance` keeps durable adapters aligned on ordering,
     idempotency, expected previous hashes, cloning, and fail-closed integrity.

5. **Server, Workbench, and MCP**
   - `server/node` is the local/self-hosted server module used by the CLI. It is
     a private workspace package today.
   - The server exposes event ingest, edge ingest, graph query, chain
     verification, export preview, local scenarios, a browser Workbench UI, and
     a JSON-RPC MCP handler.
   - Read MCP tools are enabled by default. Write tools are hidden unless the
     host starts the server with `allowWriteTools` or the CLI flag
     `--allow-write-tools`.

6. **Examples**
   - Examples are runnable integration skeletons, not the canonical protocol
     source.
   - They must keep tenant and actor resolution on the server side, prefer stable
     IDs over personal data, and avoid implying automatic regulatory coverage.

## Protocol Payloads

Audit events represent something that happened in an application:

```json
{
  "id": "evt_01",
  "schemaVersion": "2026-06-10",
  "occurredAt": "2026-06-10T00:00:00.000Z",
  "actor": { "type": "user", "id": "usr_123" },
  "action": "org.member.invited",
  "target": { "type": "organization", "id": "org_123" },
  "scope": { "tenantId": "org_123", "environment": "production" },
  "purpose": "access_management",
  "lawfulBasis": "contract",
  "retention": "security_1y",
  "metadata": { "role": "viewer" }
}
```

Evidence edges connect stable graph entities without embedding raw payloads:

```json
{
  "id": "edge_01",
  "schemaVersion": "2026-06-13",
  "occurredAt": "2026-06-13T00:00:00.000Z",
  "scope": { "tenantId": "org_123", "environment": "production" },
  "from": { "type": "agent_session", "id": "agt_sess_123" },
  "relation": "created",
  "to": { "type": "file", "id": "file_billing_plan", "pathHash": "sha256:..." },
  "metadata": { "reason": "ai_agent" }
}
```

Consent, data subject request, retention, records of processing, and export
support are represented through event actions, audit templates, graph entity
types, graph relations, retention labels, and export bundle previews. They are
not separate workflow schemas in `spec/` today.

## Integrity Model

Canonical JSON v1 sorts object keys recursively, preserves JSON `null`, omits
unsupported `undefined` values where the host language has them, rejects values
that cannot be represented safely, and emits UTF-8 JSON without HTML escaping.

Each persisted event or edge record stores:

- normalized payload
- tenant-local sequence number
- previous record hash or `null`
- current record hash
- canonicalization version
- hash algorithm
- append timestamp
- tenant-scoped idempotency-key hash

Hash rules:

- Record hash: `sha256(veritio-json-v1(record without hash))`
- Event hash: `sha256(veritio-json-v1({ event, previousHash }))`
- Edge hash: `sha256(veritio-json-v1({ edge, previousHash }))`
- Idempotency hash: `sha256(tenantId + "\u0000" + idempotencyKey)`

Verification recomputes the record envelope hash and validates tenant scope,
hash algorithm, canonicalization version, sequence order, previous-hash links,
and payload hash inputs. It detects mutation, deletion, and reordering within
the checked tenant chain.

## Privacy And Redaction

Default SDK redaction is deterministic by metadata key name. Keys matching
password, secret, token, API key, authorization, email, phone, or SSN are
replaced with a redacted marker.

Hosts must still avoid sending raw prompts, file contents, diffs, passwords,
tokens, authorization headers, cookies, raw IP addresses, precise locations,
emails, phone numbers, or payment identifiers into metadata. Prefer stable IDs,
hashes, coarse regions, counts, and bounded status values.

Agent and code-change templates reject raw prompt, diff, file-path,
stdout/stderr, tool-argument, and bearer-token-like metadata. The Claude Code
adapter records prompt hashes, content hashes, stable tool names, status, and
session IDs rather than raw tool inputs or file contents.

## Local Workbench Loop

`veritio dev --mcp --scenario` starts the local HTTP server. Core routes include:

- `POST /v1/events`
- `GET /v1/events?tenantId=...`
- `POST /v1/edges`
- `GET /v1/edges?tenantId=...`
- `GET /v1/graph?tenantId=...`
- `GET /v1/verify?tenantId=...`
- `POST /v1/exports/preview`
- `POST /v1/scenarios/integration`
- `POST /v1/scenarios/change-provenance`
- `POST /v1/scenarios/recorder`
- `POST /mcp`

The export preview includes a manifest with schema version `2026-06-14`, tenant
ID, creation time, canonicalization version, hash algorithm, record counts,
verification report, and SHA-256 file entries for the generated JSONL files.

## Hosted Boundary

The OSS repository defines portable protocol, SDK, adapter, local server, local
Workbench, verifier, and export behavior. Hosted SaaS/PaaS implementation,
hosted MCP authorization, managed storage, billing, regions, customer portals,
admin surfaces, and operational jobs belong in `veritio-cloud`.

If hosted behavior needs a new event field, edge relation, canonicalization rule,
hash input, redaction rule, idempotency rule, or export manifest field, update
the OSS protocol and SDKs here first.
