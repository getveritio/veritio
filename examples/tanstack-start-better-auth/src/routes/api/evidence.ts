import { createFileRoute } from "@tanstack/react-router";
import { getReferenceEvidenceTrail, resolveReferenceSession } from "../../server/veritio";

/**
 * Returns audit records, graph edges, and verification results for the
 * server-resolved reference tenant. The browser never supplies tenant scope.
 */
export const Route = createFileRoute("/api/evidence")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const session = await resolveReferenceSession(request);
        return Response.json(await getReferenceEvidenceTrail({ tenantId: session.tenantId, limit: 100 }));
      },
    },
  },
});
