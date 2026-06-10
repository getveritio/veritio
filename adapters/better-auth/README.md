# `@veritio/better-auth`

Better Auth adapter for emitting Veritio events for auth lifecycle activity.

The adapter is a thin mapper. Host applications own Better Auth configuration,
tenant resolution, and Veritio storage setup.

Initial event targets:

- user creation
- session creation and revocation
- organization invitation creation and acceptance
- organization/member changes when used by the host app

This adapter must receive a configured Veritio recorder from the host application. It must not read secrets or storage credentials directly.

## Usage

```ts
import { createAuditRecorder, MemoryAuditStore } from "@veritio/core";
import { createBetterAuthVeritioAdapter } from "@veritio/better-auth";

const store = new MemoryAuditStore();
const recorder = createAuditRecorder({ store });

export const veritioAuth = createBetterAuthVeritioAdapter({
  recorder,
  environment: "production",
});
```

Wire the returned methods from server-side Better Auth hooks. For example,
Better Auth `databaseHooks.user.create.after` can call `recordUserCreated`:

```ts
databaseHooks: {
  user: {
    create: {
      after: async (user) => {
        await veritioAuth.recordUserCreated({
          user: { id: user.id },
          tenantId: resolveTenantId(user),
        });
      },
    },
  },
}
```

For Better Auth organization plugin hooks, map only stable IDs and allowlisted
fields:

```ts
organizationHooks: {
  afterCreateInvitation: async ({ invitation, inviter, organization }) => {
    await veritioAuth.recordInvitationCreated({
      invitation: { id: invitation.id, role: invitation.role },
      inviter: { id: inviter.id },
      organization: { id: organization.id },
    });
  },
}
```

Do not pass raw emails, passwords, bearer tokens, reset tokens, authorization
headers, IP addresses, or user agents into adapter metadata.
