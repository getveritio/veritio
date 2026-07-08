import { createServerFn } from "@tanstack/react-start";
import type { CloudPublicConfig } from "@/server/cloud-ingest";
import type { ChangeFeedItem, EntryView, GovernedActionInput, GovernedActionResult } from "@/server/governed-entries";
import type { AgentSessionResult, AgentSessionView } from "@/server/governed-session";

/**
 * Server functions are the typed RPC boundary between the browser UI and the
 * server-owned governed-action engine. The handlers dynamically import the
 * server module so its Node-only code (file outbox, env, transport) never enters
 * the client bundle; the UI imports only these callables and the result types.
 */

export interface GovernedSnapshot {
  entries: EntryView[];
  feed: ChangeFeedItem[];
  sessions: AgentSessionView[];
  cloud: CloudPublicConfig;
}

/** Reads the entries, recent change feed, recent agent sessions, and cloud config (no token). */
export const getGovernedSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<GovernedSnapshot> => {
  const engine = await import("@/server/governed-entries");
  const sessions = await import("@/server/governed-session");
  return {
    entries: engine.listEntries(),
    feed: engine.listChangeFeed(),
    sessions: sessions.listAgentSessions(),
    cloud: engine.cloudStatus(),
  };
});

/** Runs one governed action (create / update / agent recalc / rollback). */
export const runGovernedActionFn = createServerFn({ method: "POST" })
  .inputValidator((data: GovernedActionInput) => data)
  .handler(async ({ data }): Promise<GovernedActionResult> => {
    const engine = await import("@/server/governed-entries");
    return engine.runGovernedAction(data);
  });

/**
 * Runs one governed agent session: a multi-step, `sessionId`-grouped workflow
 * (session → prompt → tool read → proposal → file change → governed recalcs →
 * human approval) that populates the Cloud's Agent Sessions / Activity Graph /
 * Code Changes / Changes surfaces from one click.
 */
export const runAgentSessionFn = createServerFn({ method: "POST" }).handler(async (): Promise<AgentSessionResult> => {
  const engine = await import("@/server/governed-session");
  return engine.runAgentSession();
});
