# Veritio Adapters

Adapters connect framework or library lifecycle events to the Veritio event protocol.

The core event model lives in `spec/` and `sdks/*`. Adapters should stay thin:

- translate framework context into actor, target, scope, and request IDs
- capture common lifecycle events
- call an injected Veritio client or storage implementation
- avoid storing credentials or reading environment variables directly

For governed create/update/delete actions, call the SDK helper
`createGovernedActionDraft` / `create_governed_action_draft` /
`CreateGovernedActionDraft` from the host application's server-side mutation
boundary. Adapters may pass framework context into that flow, but they do not
own storage, protocol semantics, tenant authority, or hosted configuration. See
`../docs/integrations.md` for framework recipes.

## Adapters

- `@veritio/better-auth`
- `@veritio/next`
- `@veritio/tanstack-start`
- `@veritio/sveltekit`
- `@veritio/react`
- `@veritio/vue`
- `@veritio/svelte`
- `@veritio/express` (planned)
- `@veritio/hono` (planned)
- `@veritio/trpc` (planned)
- `veritio-fastapi` (planned)
