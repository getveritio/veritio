import { NextResponse } from "next/server";
import { getReferenceAuditTrail } from "../../../src/veritio/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const trail = await getReferenceAuditTrail(100);

  return NextResponse.json({
    tenantId: trail.session.tenantId,
    verification: trail.verification,
    records: trail.records,
  });
}
