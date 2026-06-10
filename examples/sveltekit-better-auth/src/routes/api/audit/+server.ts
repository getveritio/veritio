import { json, type RequestHandler } from "@sveltejs/kit";
import { listAuditTrailForTenant, resolveReferenceSession } from "$lib/server/veritio";

export const GET: RequestHandler = async (event) => {
  const session = await resolveReferenceSession(event);

  return json({
    records: await listAuditTrailForTenant({ tenantId: session.tenantId, limit: 100 }),
  });
};
