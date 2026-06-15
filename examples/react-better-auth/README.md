# React + Better Auth Example

Reference skeleton for a Vite React client with a server-side Better Auth and
Veritio boundary. It is not installed by the root workspace verification
command.

Browser code calls same-origin application API routes only. The recorder, Better
Auth hook bridge, and audit listing logic stay in `server/`. Recording happens
only on the server.

## Run

This example is two processes: a Vite client (port 5173) and an Express recorder
(port 3001). The Vite dev proxy forwards `/api/*` to the Express server.

```sh
cd examples/react-better-auth
bun install

# Terminal 1 — Express recorder on http://localhost:3001
bun run dev:server

# Terminal 2 — Vite client on http://localhost:5173
bun run dev
```

Open `http://localhost:5173`, click **Record profile update**, then **Load audit
trail** to see the recorded, hash-chained event.

This example is zero-config (in-memory `MemoryAuditStore`, hard-coded
`tenant_demo` / `user_demo`). It contains no storage connection configuration.
Replace `MemoryAuditStore` and the reference session with a durable store and a
real Better Auth session on the server before production use.
