# Next.js + Better Auth Example

This example will show how a Next.js application can use Better Auth and Veritio together.

Planned flow:

1. Configure a Veritio recorder on the server.
2. Wire Better Auth lifecycle events to `@veritio/better-auth`.
3. Emit application mutation events through `@veritio/next`.
4. Query the audit trail through a server-only route.
5. Render an accessible customer-facing audit view.
