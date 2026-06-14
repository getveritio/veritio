import { createFileRoute } from "@tanstack/react-router";
import { listAuditTrailForTenant, resolveReferenceSession } from "../../server/veritio";

export const Route = createFileRoute("/api/audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await resolveReferenceSession(request);

        const records = await listAuditTrailForTenant({ tenantId: session.tenantId, limit: 100 });
        return Response.json({ records });
      },
    },
  },
});
