# `@veritio/sveltekit`

SvelteKit adapter for hooks, load functions, actions, and endpoints.

This package does not import SvelteKit runtime APIs. Host applications inject a configured Veritio recorder and explicit request context from server-side code.

## Usage

```ts
import { createSvelteKitVeritioAdapter } from "@veritio/sveltekit";
import { createAuditRecorder } from "@veritio/core";

const veritio = createSvelteKitVeritioAdapter({
  recorder: createAuditRecorder({ store }),
  environment: "production",
  resolveContext(input) {
    const locals = input.locals as { tenantId: string; userId: string };
    return {
      tenantId: locals.tenantId,
      actor: { type: "user", id: locals.userId },
      requestId: "req_123"
    };
  }
});

await veritio.recordAction({
  locals,
  action: "account.preferences.updated",
  target: { type: "account", id: "acct_123" },
  dataCategories: ["preferences"]
});
```

Browser code should not receive storage credentials, provider tokens, stores, or recorders. Veritio supports audit trail evidence workflows; it does not guarantee legal compliance.
