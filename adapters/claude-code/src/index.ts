/**
 * @veritio/claude-code — capture Claude Code agent activity as Veritio evidence.
 *
 * The hook CLI (`veritio-claude-code-hook`, dist/hook.js) is the runtime entry,
 * wired into Claude Code's settings.json. This module re-exports the pure,
 * reusable building blocks (config resolution, redaction, per-session state, the
 * hook→recorder mapping, and the ingest poster) for embedding or testing.
 */
export * from "./config";
export * from "./ingest";
export * from "./map";
export * from "./query";
export * from "./redact";
export * from "./state";
export type { HookPayload, SessionContext } from "./types";
