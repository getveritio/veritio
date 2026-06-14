# `@veritio/server`

Local and self-hosted Node server surface for ingestion, querying, verification,
MCP, and export preview.

The current local server exposes:

- event ingestion
- evidence graph edge ingestion
- hash-chain verification
- evidence graph query
- local integration scenario
- export bundle preview
- browser Workbench UI
- MCP JSON-RPC handler with read tools enabled by default

```ts
import { startWorkbenchServer } from "@veritio/server";

const server = await startWorkbenchServer({
  host: "127.0.0.1",
  port: 4983,
  allowWriteTools: false
});

console.log(server.url);
```

Storage credentials must be configured by the server operator and never sent to
browser clients. The local Workbench store is for development and integration
proofs; durable production storage should use host-injected adapters.
