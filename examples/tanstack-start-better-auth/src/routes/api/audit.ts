import { listAuditTrailForTenant, resolveReferenceSession } from "../../server/veritio";

export async function GET({ request }: { request: Request }) {
  const session = await resolveReferenceSession(request);

  const records = await listAuditTrailForTenant({
    tenantId: session.tenantId,
    limit: 100,
  });

  return Response.json({ records });
}
