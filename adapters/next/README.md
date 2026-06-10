# `@veritio/next`

Next.js adapter for route handlers, server actions, and request-scoped evidence support.

This package does not import Next.js runtime APIs. Host applications inject a configured Veritio recorder and explicit request context from server-side code.

## Usage

```ts
import { createNextVeritioAdapter } from "@veritio/next";
import { createAuditRecorder } from "@veritio/core";

const veritio = createNextVeritioAdapter({
  recorder: createAuditRecorder({ store }),
  environment: "production",
  resolveContext() {
    return {
      tenantId: "org_123",
      actor: { type: "user", id: "usr_123" },
      requestId: "req_123"
    };
  }
});

export async function POST(request: Request) {
  await updateProject();
  await veritio.recordRouteHandler({
    request,
    action: "project.settings.updated",
    target: { type: "project", id: "proj_123" },
    purpose: "project_management"
  });
}
```

Browser code should not receive storage credentials, provider tokens, stores, or recorders. Veritio provides audit trail evidence support and is not legal advice or automatic compliance.
