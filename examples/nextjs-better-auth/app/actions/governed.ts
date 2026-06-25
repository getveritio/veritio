"use server";

import { revalidatePath } from "next/cache";
import {
  runGovernedAction,
  type GovernedActionInput,
  type GovernedActionResult,
} from "../../src/server/governed-entries";
import { runAgentSession, type AgentSessionResult } from "../../src/server/governed-session";

/**
 * App Router server action: the only path the browser uses to record a governed
 * change. It runs entirely on the server — the SDK capture, the transactional
 * outbox enqueue, and the server-to-server dispatch to hosted ingest all happen
 * here, so the ingest token and tenant id never reach the client. After the
 * mutation it revalidates `/` so the server component re-reads the in-memory
 * snapshot (entries + change feed) on the next render; the returned result feeds
 * the client's transient "last change" banner.
 *
 * Identity is server-owned: the client may only send the action shape (kind,
 * entryId, edited business values), never `tenantId` or the resolved actor.
 */
export async function submitGovernedAction(input: GovernedActionInput): Promise<GovernedActionResult> {
  const result = await runGovernedAction(input);
  revalidatePath("/");
  return result;
}

/**
 * App Router server action for the agent-session capability. One call runs a
 * full governed AI workflow on the server (session → prompt → tool read →
 * proposal → file change → governed recalcs → human approval), all grouped under
 * one `sessionId`, then revalidates `/` so the server component re-reads the new
 * session and the recalculated entries. Recorder evidence is delivered as direct
 * batches and the recalcs flow through the outbox — the ingest token and tenant
 * id stay on the server.
 */
export async function runAgentSessionAction(): Promise<AgentSessionResult> {
  const result = await runAgentSession();
  revalidatePath("/");
  return result;
}
