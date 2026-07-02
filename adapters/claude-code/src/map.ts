import type { FileChangeInput, FileModification, ToolCallInput } from "@veritio/core";
import type { AdapterConfig } from "./config.js";
import { hashJson, pathEntityId, sha256 } from "./redact.js";
import type { HookPayload, SessionContext } from "./types.js";

/** Claude Code tools whose `tool_input.file_path` yields a recordable file change. */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * Derives the stable activity-episode id that groups one Claude Code session's
 * events. Deterministic from the session id so every separate hook process
 * resolves the same episode without shared memory.
 */
export function episodeIdOf(sessionId: string): string {
  return `ep_${sanitize(sessionId)}`;
}

/**
 * Builds the StartSessionInput captured at SessionStart. `now` and git facts are
 * passed in (the hook does the I/O) so this stays pure and deterministic; the
 * result is persisted and replayed verbatim on later events.
 */
export function buildSessionContext(
  payload: HookPayload,
  config: AdapterConfig,
  opts: { now: string; activityEpisodeId: string; branch?: string; repository?: { provider: string; id: string } },
): SessionContext {
  const context: SessionContext = {
    scope: {
      tenantId: config.tenantId,
      environment: config.environment,
      ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
    },
    sessionId: payload.session_id,
    initiatedBy: { type: "user", id: config.actorId },
    agentActor: { type: "ai_agent", id: config.agentActorId },
    agent: { name: "claude-code" },
    model: { provider: "anthropic", name: payload.model ?? "claude" },
    occurredAt: opts.now,
    purpose: "agent_provenance",
  };
  context.activityEpisodeId = opts.activityEpisodeId;
  if (opts.branch) {
    context.branch = opts.branch;
  }
  if (opts.repository) {
    context.repository = opts.repository;
  }
  return context;
}

/** The promptHash for a UserPromptSubmit event — the raw prompt is never stored. */
export function promptHashOf(payload: HookPayload): string {
  return sha256(payload.prompt ?? "");
}

/**
 * Builds the tool-call record (and, for edit tools, the file-change record) for a
 * PostToolUse / PostToolUseFailure event. The file edges live ONLY on the
 * fileChange (changedBy = the tool call) — never also on `toolCall.modifies` —
 * so the `tool_call --modified--> file` edge is emitted exactly once.
 */
export function buildToolCall(
  payload: HookPayload,
  config: AdapterConfig,
  opts: {
    seq: number;
    now: string;
    status: "succeeded" | "failed";
    preImages: Record<string, string>;
    afterHashes: Record<string, string>;
  },
): { toolCall: ToolCallInput; fileChange?: FileChangeInput } {
  const toolCallId = `tc_${sanitize(payload.session_id)}_${opts.seq}`;
  const tool = payload.tool_name ?? "unknown";
  const toolCall: ToolCallInput = {
    toolCallId,
    tool,
    status: opts.status,
    occurredAt: opts.now,
    inputHash: hashJson(payload.tool_input ?? {}),
  };

  const filePath =
    EDIT_TOOLS.has(tool) && typeof payload.tool_input?.file_path === "string"
      ? (payload.tool_input.file_path as string)
      : undefined;
  const afterHash = filePath ? opts.afterHashes[filePath] : undefined;
  if (!filePath || !afterHash) {
    return { toolCall };
  }

  const beforeHash = opts.preImages[filePath];
  const pathHash = sha256(filePath);
  const file: FileModification = {
    id: pathEntityId(pathHash),
    pathHash,
    afterHash,
    action: tool === "Write" && !beforeHash ? "create" : "upsert",
  };
  if (beforeHash) {
    file.beforeHash = beforeHash;
  }
  const fileChange: FileChangeInput = {
    sourceTreeId: `tree_${sanitize(config.tenantId)}`,
    occurredAt: opts.now,
    changedBy: { type: "tool_call", id: toolCallId },
    files: [file],
  };
  return { toolCall, fileChange };
}

/** A changed file discovered by the Stop-turn git scan (catches Bash-driven writes). */
export interface ChangedFile {
  pathHash: string;
  afterHash: string;
  action: "create" | "upsert" | "delete";
}

/**
 * Builds the file-change record for files a turn changed on disk that no edit
 * tool reported (Bash writes). `changedBy` is omitted so the recorder attributes
 * them to the session entity. Returns null when nothing changed.
 */
export function buildBashFileChange(
  files: ChangedFile[],
  config: AdapterConfig,
  opts: { now: string; turn: number },
): FileChangeInput | null {
  if (files.length === 0) {
    return null;
  }
  return {
    sourceTreeId: `tree_${sanitize(config.tenantId)}`,
    occurredAt: opts.now,
    files: files.map((file) => ({
      id: pathEntityId(file.pathHash),
      pathHash: file.pathHash,
      afterHash: file.afterHash,
      action: file.action,
    })),
  };
}
