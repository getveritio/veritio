import { NextResponse } from "next/server";
import { listAuditTrailForTenant, resolveReferenceSession } from "../../../src/veritio/server";

export async function GET() {
  const session = await resolveReferenceSession();

  const records = await listAuditTrailForTenant({ tenantId: session.tenantId, limit: 100 });
  return NextResponse.json({ records });
}
