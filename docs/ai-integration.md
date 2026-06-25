# AI Integration Guide

This repository is designed so AI coding agents can inspect, emit, query, and
verify application evidence without inventing protocol details or leaking
private host data.

## Stable Starting Points

- `spec/event.schema.json`: language-neutral audit event contract.
- `spec/edge.schema.json`: language-neutral evidence graph edge contract.
- `spec/audit-record.schema.json`: append-only audit record envelope.
- `spec/edge-record.schema.json`: append-only edge record envelope.
- `spec/conformance/`: canonical JSON, hashing, redaction, and creation vectors.
- `sdks/typescript/src/index.ts`: TypeScript SDK entrypoint.
- `sdks/typescript/src/provenance.ts`: TS-only agent/change provenance recorder.
- `sdks/python/src/veritio/__init__.py`: Python SDK entrypoint.
- `sdks/go/event.go`: Go SDK entrypoint.
- `server/node/src/index.ts`: local Workbench, MCP, graph, verification, and
  export preview implementation.
- `adapters/claude-code/`: Claude Code hook capture and reference MCP query
  adapter.

## Agent Rules

- Keep protocol semantics in `spec/` and SDKs, not in a framework adapter.
- Do not send secrets, raw tokens, passwords, API keys, cookies, authorization
  headers, raw prompts, raw tool inputs, command output, file contents, or diffs
  into event metadata.
- Prefer stable IDs, content hashes, path hashes, counts, coarse locations, and
  bounded status fields.
- Always include tenant scope before appending durable records in a multi-tenant
  host.
- Treat `metadata` as potentially sensitive and pass it through SDK redaction.
- Link related evidence with edges that reference stable entity IDs or hashes.
- Do not claim Veritio guarantees compliance; use evidence support wording.
- Do not copy private execution specs, roadmap details, or operational prompts
  into public docs or examples.

## Common Event Shape

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

## Common Edge Shape

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

## Agent Provenance

The TypeScript SDK exports `createProvenanceRecorder`. It emits agent, change,
review, CI, deployment, and runtime observation events and connects them through
evidence edges.

Recorder conventions:

- Every session-related event gets `metadata.sessionId`.
- Event IDs are deterministic from stable caller IDs unless overridden.
- Edges derive from stable entity references.
- The enforcing human is linked through a `caused_by` edge rather than a new
  event field.
- The host injects `recordEvent` and `recordEdge` sinks; the recorder owns no
  storage transaction.

Python and Go do not yet expose the same high-level recorder. They should keep
event and edge semantics aligned so a later recorder can emit equivalent
payloads.

## Claude Code Capture

`@veritio/claude-code` captures Claude Code activity passively through hooks.
The hook writes redacted local evidence to `createFileEvidenceStore` and can
optionally POST the same records to an ingest endpoint when the host supplies
both an ingest URL and key.

Captured evidence keeps raw content out of storage:

- prompts are represented by hashes
- file changes use before/after content hashes and path hashes
- tool inputs and command output are not persisted
- MCP query/export reads the local file-backed store

The adapter includes a read-only MCP server with tools to list sessions, inspect
a session graph, and export a verifiable bundle.

## Local Agent Check

Start the local Workbench and MCP endpoint:

```sh
veritio dev --mcp --scenario
```

Then use MCP JSON-RPC `tools/list` and `tools/call` requests against `/mcp`.
Read tools include event listing, edge listing, graph query, chain verification,
export preview, and integration scenarios. Write tools are hidden unless the
server starts with `--allow-write-tools`.

## Repository Routing

Agents should route work by source of truth:

- Protocol fields, schemas, hashes, redaction, SDK behavior, adapters, storage,
  local server, verifier, export format, and examples: `veritio`.
- Public site pages, SEO metadata, marketing copy, website docs pages, and
  static assets: `veritio-website`.
- Hosted ingest, hosted MCP, managed storage, billing, regions, admin,
  customer portals, and operational jobs: `veritio-cloud`.

For cross-repo work, update public protocol and SDK behavior in this repo first,
then hosted behavior, then website claims after backing behavior exists.
