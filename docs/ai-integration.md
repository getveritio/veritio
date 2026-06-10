# AI Integration Guide

This repository is designed to be easy for AI coding agents to integrate safely.

## Stable Starting Points

- `spec/event.schema.json` defines the language-neutral event contract.
- `sdks/typescript/src/index.ts` is the TypeScript SDK entrypoint.
- `sdks/python/src/veritio/__init__.py` is the Python SDK entrypoint.
- `sdks/go/event.go` is the Go SDK entrypoint.

## Integration Rules

- Do not send secrets, raw tokens, passwords, API keys, or authorization headers into event metadata.
- Prefer stable IDs over emails and display names.
- Always include tenant scope when an application is multi-tenant.
- Use retention classes instead of ad hoc retention dates in application code.
- Treat `metadata` as potentially sensitive and run it through SDK redaction.

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
