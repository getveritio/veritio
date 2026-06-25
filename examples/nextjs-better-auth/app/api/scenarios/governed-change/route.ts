import { NextResponse } from "next/server";
import { resolveReferenceSession, runGovernedChangeScenario } from "../../../../src/veritio/server";

export const dynamic = "force-dynamic";

/**
 * Runs the governed-change scenario through an HTTP route for local browser and
 * curl smoke tests without accepting tenant or actor IDs from the client.
 */
export async function POST(request: Request) {
  const session = await resolveReferenceSession(request);
  return NextResponse.json(await runGovernedChangeScenario(session));
}
