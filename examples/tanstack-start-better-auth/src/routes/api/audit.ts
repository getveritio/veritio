import { createFileRoute } from "@tanstack/react-router";
import { listAuditTrailForTenant, resolveReferenceSession } from "../../server/veritio";

/**
 * Returns the audit trail for the server-resolved reference tenant. Tenant
 * identity is resolved on the server and never read from browser input.
 */
export const Route = createFileRoute("/api/audit")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const session = await resolveReferenceSession(request);
        const records = await listAuditTrailForTenant({
          tenantId: session.tenantId,
          limit: 100,
        });
        return Response.json({ records });
      },
    },
  },
});
