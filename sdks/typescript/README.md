# @veritio/core

Protocol-first TypeScript SDK for Veritio audit trail and evidence graph records.

## Install

```sh
npm install @veritio/core
```

## Usage

```ts
import { MemoryAuditStore, createAuditEvent, createEvidenceEdge, hashEvidenceEdge } from "@veritio/core";

const store = new MemoryAuditStore();

const event = createAuditEvent({
  actor: { type: "user", id: "usr_123" },
  action: "org.member.invited",
  target: { type: "organization", id: "org_123" },
  scope: { tenantId: "org_123", environment: "production" },
  metadata: { role: "viewer" }
});

await store.append(event);

const edge = createEvidenceEdge({
  from: { type: "actor", id: "usr_123", actorType: "user" },
  relation: "created",
  to: { type: "runtime_event", id: event.id },
  scope: { tenantId: "org_123", environment: "production" },
  metadata: { reason: "member_invite" }
});

const edgeHash = hashEvidenceEdge(edge);
```

## Audit Templates

Use `auditTemplates` when an app wants the common auth, organization, data,
agent, and code-change actions without hand-writing action strings:

```ts
import { auditLogClassificationMetadata, auditTemplates, createAuditEvent } from "@veritio/core";

const signedIn = createAuditEvent(
  auditTemplates.auth.signedIn({
    userId: "usr_123",
    sessionId: "sess_123",
    scope: { tenantId: "org_123", environment: "production" },
    securityContext: {
      ipAddressHash: "sha256:client-ip",
      userAgentHash: "sha256:user-agent",
      location: { country: "US", region: "CA" },
    },
    metadata: auditLogClassificationMetadata({ visibility: "customer", surface: "app" }),
  }),
);

const filesChanged = createAuditEvent(
  auditTemplates.code.filesChanged({
    sourceTreeId: "tree_123",
    actor: { type: "ai_agent", id: "agent_codex" },
    scope: { tenantId: "org_123", environment: "production" },
    sessionId: "agt_sess_123",
    fileCount: 3,
    filePathHashes: ["sha256:path-a", "sha256:path-b"],
  }),
);
```

Agent and code templates reject raw prompt, diff, file-path, stdout/stderr, tool
argument, and bearer-token-like metadata. Use ids, counts, hashes, and bounded
status fields instead.

`auditLogClassificationMetadata` and `detectAuditLogClassifiers` provide
portable DX for filters such as internal/external/partner/system logs and
api/app/worker/cli/webhook surfaces. They only write/read metadata keys
(`logVisibility`, `logSurface`); they are not new protocol fields.

Veritio supports evidence collection and verification workflows. It is not legal advice and does not make an application automatically compliant with any regulation or framework.
