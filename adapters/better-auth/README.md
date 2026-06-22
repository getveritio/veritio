# `@veritio/better-auth`

Better Auth adapter for emitting Veritio events for auth lifecycle activity.

The adapter is a thin mapper. Host applications own Better Auth configuration,
tenant resolution, and Veritio storage setup.

Initial event targets:

- user creation
- session creation and revocation
- organization creation
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

Session hooks can pass an allowlisted auth-security context object when the host
intentionally records sign-in/logout context:

```ts
databaseHooks: {
  session: {
    create: {
      after: async (session, context) => {
        await veritioAuth.recordSessionCreated({
          user: { id: session.userId },
          session: { id: session.id },
          tenantId: await resolveTenantId(session.userId),
          requestId: context?.headers.get("x-request-id") ?? undefined,
          securityContext: {
            ipAddressHash: await hashIpAddress(session.ipAddress),
            userAgentHash: await hashUserAgent(session.userAgent),
            location: await resolveCountryRegion(context),
          },
        });
      },
    },
    delete: {
      after: async (session, context) => {
        await veritioAuth.recordSessionRevoked({
          user: { id: session.userId },
          session: { id: session.id },
          tenantId: await resolveTenantId(session.userId),
          requestId: context?.headers.get("x-request-id") ?? undefined,
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
  afterCreateOrganization: async ({ organization, user }) => {
    await veritioAuth.recordOrganizationCreated({
      actor: { id: user.id },
      organization: { id: organization.id },
    });
  },
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
headers, cookies, raw IP addresses, precise locations, or raw user agents into
adapter metadata. Prefer `securityContext.ipAddressHash`, `networkHash`,
`userAgentHash`, and country/region location when the host has intentionally
chosen to capture authentication security context.
