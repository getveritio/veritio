import type { StartSessionInput } from "@veritio/core";

/**
 * The subset of a Claude Code hook stdin payload this adapter consumes. Field
 * names match the verified hooks contract (CC 2.1.x). Unknown events carry only
 * the common fields and are ignored.
 */
export interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  transcript_path?: string;
  model?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
}

/**
 * The full StartSessionInput captured at SessionStart and persisted, then replayed
 * verbatim on every later event so the recorder re-emits the session-start event
 * idempotently (same id + same canonical bytes => store replay, no duplicate).
 */
export type SessionContext = StartSessionInput;
