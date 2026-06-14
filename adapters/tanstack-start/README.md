# `@veritio/tanstack-start`

TanStack Start adapter for server functions, route handlers, and request-scoped audit context.

This package does not import TanStack Start runtime APIs. Host applications inject a configured Veritio recorder and explicit request context from server-side code.

## Usage

```ts
import { createTanStackStartVeritioAdapter } from "@veritio/tanstack-start";
import { createAuditRecorder } from "@veritio/core";

const veritio = createTanStackStartVeritioAdapter({
  recorder: createAuditRecorder({ store }),
  environment: "production",
  resolveContext(input) {
    return {
      tenantId: input.params?.orgId ?? "org_123",
      actor: { type: "service", id: "tanstack-start" },
      requestId: "req_123"
    };
  }
});

await veritio.recordServerFunction({
  params: { orgId: "org_123" },
  action: "billing.plan.changed",
  target: { type: "subscription", id: "sub_123" },
  lawfulBasis: "contract"
});
```

Browser code should not receive storage credentials, provider tokens, stores, or recorders. Veritio supports audit trail evidence workflows; it does not guarantee legal compliance.
