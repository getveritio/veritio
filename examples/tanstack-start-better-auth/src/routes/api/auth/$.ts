import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth";

/**
 * Mounts the Better Auth Web Request handler on the TanStack Start catch-all
 * auth route. Better Auth owns request parsing here, while Veritio evidence is
 * emitted from database hooks through the server-owned tenant boundary.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => auth.handler(request),
      POST: async ({ request }: { request: Request }) => auth.handler(request),
    },
  },
});
