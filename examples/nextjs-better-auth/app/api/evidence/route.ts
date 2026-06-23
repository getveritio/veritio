import { NextResponse } from "next/server";
import { getReferenceEvidenceTrail } from "../../../src/veritio/server";

export const dynamic = "force-dynamic";

/**
 * Returns the complete local evidence trail for the server-resolved reference
 * tenant: audit events, graph edges, project state, and verification status.
 */
export async function GET() {
  const trail = await getReferenceEvidenceTrail(100);

  return NextResponse.json({
    tenantId: trail.session.tenantId,
    verification: trail.verification,
    edgeVerification: trail.edgeVerification,
    records: trail.records,
    edgeRecords: trail.edgeRecords,
    projects: trail.projects,
  });
}
