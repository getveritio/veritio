import { json, type RequestHandler } from "@sveltejs/kit";
import { runAgentSession } from "$lib/server/governed-session";

/**
 * Runs one governed agent session end to end (session → prompt → tool read →
 * proposal → governed recalcs → human approval, all under one server-owned
 * `sessionId`). The session takes no client input — tenant, actor, agent, and
 * session identity are all owned by the `$lib/server` boundary; the browser only
 * triggers the run and reads back the resulting session view. On failure a
 * sanitized error is returned (never raw server text).
 */
export const POST: RequestHandler = async () => {
  try {
    return json(await runAgentSession());
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "agent session failed" }, { status: 500 });
  }
};
