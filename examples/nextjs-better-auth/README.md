# Next.js + Better Auth Example

This directory is currently an integration guide, not a runnable Next.js app.
It shows the server-side shape a future example app should implement.

## Flow

1. Configure a Veritio recorder on the server.
2. Wire Better Auth lifecycle events to `@veritio/better-auth`.
3. Emit application mutation events through a server-only helper.
4. Query the audit trail through a server-only route.
5. Render a customer-facing audit view from scoped records.

## Server-Side Sketch

```ts
import { createAuditRecorder, MemoryAuditStore } from "veritio";
import { createBetterAuthVeritioAdapter } from "@veritio/better-auth";

const store = new MemoryAuditStore();
const recorder = createAuditRecorder({ store });

export const veritioAuth = createBetterAuthVeritioAdapter({
  recorder,
  environment: "development",
});

// In Better Auth databaseHooks.user.create.after:
await veritioAuth.recordUserCreated({
  user: { id: user.id },
  tenantId: organization.id,
  requestId,
});

// In Better Auth organizationHooks.afterCreateInvitation:
await veritioAuth.recordInvitationCreated({
  invitation: { id: invitation.id, role: invitation.role },
  inviter: { id: inviter.id },
  organization: { id: organization.id },
  requestId,
});
```

`MemoryAuditStore` is process-local and intended for development examples only.
Production deployments should use a durable append-only store when implemented.
