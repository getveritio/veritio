# Veritio Adapters

Adapters connect framework or library lifecycle events to the Veritio event protocol.

The core event model lives in `spec/` and `sdks/*`. Adapters should stay thin:

- translate framework context into actor, target, scope, and request IDs
- capture common lifecycle events
- call an injected Veritio client or storage implementation
- avoid storing credentials or reading environment variables directly

## Planned Adapters

- `@veritio/better-auth`
- `@veritio/next`
- `@veritio/tanstack-start`
- `@veritio/sveltekit`
- `@veritio/express`
- `@veritio/hono`
- `@veritio/trpc`
- `@veritio/fastapi`
