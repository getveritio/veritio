# @veritio/core

Protocol-first TypeScript SDK for Veritio audit trail evidence.

## Install

```sh
npm install @veritio/core
```

## Usage

```ts
import { MemoryAuditStore, createAuditEvent } from "@veritio/core";

const store = new MemoryAuditStore();

const event = createAuditEvent({
  actor: { type: "user", id: "usr_123" },
  action: "org.member.invited",
  target: { type: "organization", id: "org_123" },
  scope: { tenantId: "org_123", environment: "production" },
  metadata: { role: "viewer" }
});

await store.append(event);
```

Veritio supports evidence collection and verification workflows. It is not legal advice and does not make an application automatically compliant with any regulation or framework.
