import { NextResponse } from "next/server";
import { resolveReferenceSession, runGovernedLifecycleScenario } from "../../../../src/veritio/server";

export const dynamic = "force-dynamic";

/**
 * Runs the larger helper-driven lifecycle scenario through a route handler so
 * local HTTP smokes can verify event and graph chains end to end.
 */
export async function POST(request: Request) {
  const session = await resolveReferenceSession(request);
  return NextResponse.json(await runGovernedLifecycleScenario(session));
}
