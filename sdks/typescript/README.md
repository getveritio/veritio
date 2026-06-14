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

Veritio supports evidence collection and verification workflows. It is not legal advice and does not make an application automatically compliant with any regulation or framework.
