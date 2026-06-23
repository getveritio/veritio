import { json, type RequestHandler } from "@sveltejs/kit";
import { getReferenceEvidenceTrail, resolveReferenceSession } from "$lib/server/veritio";

/**
 * Returns audit records, graph edges, and verification results for the
 * server-resolved reference tenant. Tenant identity never comes from the
 * browser request body or query string.
 */
export const GET: RequestHandler = async (event) => {
  const session = await resolveReferenceSession(event);
  return json(await getReferenceEvidenceTrail({ tenantId: session.tenantId, limit: 100 }));
};
