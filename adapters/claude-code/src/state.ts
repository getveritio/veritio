import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SessionContext } from "./types";

/**
 * Per-session state persisted between hook process invocations (each hook event
 * runs as a fresh process). Holds the session context replayed on every event,
 * a monotonic tool-call counter for deterministic tool ids, and the pre-image
 * content hashes captured in PreToolUse so PostToolUse can record a before/after.
 */
export interface SessionState {
  context: SessionContext | null;
  toolSeq: number;
  /** file_path -> beforeHash, captured at PreToolUse. */
  preImages: Record<string, string>;
  /** Monotonic per-turn counter for Bash file-change ids. */
  turn: number;
  /** Stable activity-episode id grouping this session's events; null until SessionStart. */
  activityEpisodeId: string | null;
}

function statePath(dir: string, sessionId: string): string {
  return join(dir, "state", `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

/** Loads a session's state, returning a fresh empty state when none exists yet. */
export function loadState(dir: string, sessionId: string): SessionState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dir, sessionId), "utf8")) as Partial<SessionState>;
    return {
      context: parsed.context ?? null,
      toolSeq: parsed.toolSeq ?? 0,
      preImages: parsed.preImages ?? {},
      turn: parsed.turn ?? 0,
      activityEpisodeId: parsed.activityEpisodeId ?? null,
    };
  } catch {
    return { context: null, toolSeq: 0, preImages: {}, turn: 0, activityEpisodeId: null };
  }
}

/** Persists a session's state (creating the state directory on first write). */
export function saveState(dir: string, sessionId: string, state: SessionState): void {
  const path = statePath(dir, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state), "utf8");
}

/** Removes a session's state file (called at SessionEnd). */
export function clearState(dir: string, sessionId: string): void {
  rmSync(statePath(dir, sessionId), { force: true });
}
