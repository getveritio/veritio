import { json, type RequestHandler } from "@sveltejs/kit";
import { resolveReferenceSession, runGovernedLifecycleScenario } from "$lib/server/veritio";

/**
 * Runs the multi-step governed lifecycle scenario from the SvelteKit server
 * boundary so tenant, actor, and graph scope remain host-owned.
 */
export const POST: RequestHandler = async (event) => {
  const session = await resolveReferenceSession(event);
  return json(await runGovernedLifecycleScenario(session));
};
