import { createHash } from "node:crypto";
import type { StartSessionInput } from "@veritio/core";
import type { CodexAdapterConfig } from "./config.js";

/**
 * The subset of a Codex CLI `notify` payload this adapter consumes. Codex fires
 * the notify program once per turn; `agent-turn-complete` is the only type that
 * carries a prompt. Field names match Codex's notify contract (both hyphen and
 * snake_case spellings are tolerated across CLI versions). Raw message text is
 * NEVER persisted — only its hash and stable ids travel.
 */
export interface CodexNotifyPayload {
  type?: string;
  "turn-id"?: string;
  turn_id?: string;
  "input-messages"?: string[];
  input_messages?: string[];
  cwd?: string;
}

/** Deterministic, prefixed sha256 of a UTF-8 string (one-way; the raw prompt never leaves). */
export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** Reads the turn id across Codex CLI spellings; "unknown" keeps the hook total. */
export function turnIdOf(payload: CodexNotifyPayload): string {
  return payload["turn-id"] ?? payload.turn_id ?? "unknown";
}

/**
 * Derives the stable session id for a Codex turn. Codex notify has no session
 * id, so we hash the turn id into a `codex_<16 hex>` handle — deterministic, so
 * re-delivery of the same notification replays the same records idempotently.
 */
export function sessionIdOf(payload: CodexNotifyPayload): string {
  const hash = createHash("sha256").update(turnIdOf(payload), "utf8").digest("hex");
  return `codex_${hash.slice(0, 16)}`;
}

/** The prompt hash for a turn — the concatenated input messages, never their text. */
export function promptHashOf(payload: CodexNotifyPayload): string {
  const messages = payload["input-messages"] ?? payload.input_messages ?? [];
  return sha256(messages.join("\n"));
}

/**
 * Builds the StartSessionInput for one Codex turn. Codex notify does not report
 * the model, so it is left generic; `now` is passed in (the hook does the I/O)
 * to keep this pure and deterministic.
 */
export function buildSessionContext(
  payload: CodexNotifyPayload,
  config: CodexAdapterConfig,
  opts: { now: string },
): StartSessionInput {
  const context: StartSessionInput = {
    scope: {
      tenantId: config.tenantId,
      environment: config.environment,
      ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
    },
    sessionId: sessionIdOf(payload),
    initiatedBy: { type: "user", id: config.actorId },
    agentActor: { type: "ai_agent", id: config.agentActorId },
    agent: { name: "codex-cli" },
    model: { provider: "openai", name: "codex" },
    occurredAt: opts.now,
    purpose: "agent_provenance",
    activityEpisodeId: `ep_${sessionIdOf(payload)}`,
  };
  return context;
}
