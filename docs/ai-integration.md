# AI Integration Guide

This repository is designed to be easy for AI coding agents to integrate safely.

## Stable Starting Points

- `spec/event.schema.json` defines the language-neutral event contract.
- `spec/edge.schema.json` defines language-neutral evidence graph edge payloads.
- `spec/edge-record.schema.json` defines the edge record envelope for append-only storage.
- `sdks/typescript/src/index.ts` is the TypeScript SDK entrypoint.
- `sdks/python/src/veritio/__init__.py` is the Python SDK entrypoint.
- `sdks/go/event.go` is the Go SDK entrypoint.

## Integration Rules

- Do not send secrets, raw tokens, passwords, API keys, or authorization headers into event metadata.
- Prefer stable IDs over emails and display names.
- Always include tenant scope when an application is multi-tenant.
- Use retention classes instead of ad hoc retention dates in application code.
- Treat `metadata` as potentially sensitive and run it through SDK redaction.
- Link records with evidence edges that reference stable IDs and hashes, not raw prompts, file contents, diffs, or command output.

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

## Local Agent Check

Run the local Workbench and MCP endpoint:

```sh
veritio dev --mcp --scenario
```

Agents can call `/mcp` with JSON-RPC `tools/list` and `tools/call` requests.
Read tools include event listing, graph query, chain verification, export
preview, and the integration scenario. Write tools such as
`veritio.record_event`, `veritio.record_edge`, and `veritio.reset_dev_store`
are hidden unless the server is started with `--allow-write-tools`.
