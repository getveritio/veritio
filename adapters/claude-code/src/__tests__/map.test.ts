import { describe, expect, test } from "bun:test";

import type { AdapterConfig } from "../config";
import { buildBashFileChange, buildSessionContext, buildToolCall, episodeIdOf, promptHashOf } from "../map";
import type { HookPayload } from "../types";

const config: AdapterConfig = {
  localDir: "/tmp/veritio",
  tenantId: "local",
  actorId: "usr_dev",
  agentActorId: "agent_cc",
  environment: "development",
};

const NOW = "2026-06-18T12:00:00.000Z";

function payload(extra: Partial<HookPayload>): HookPayload {
  return { hook_event_name: "PostToolUse", session_id: "sess_a", ...extra };
}

describe("buildSessionContext", () => {
  test("maps a SessionStart payload to a StartSessionInput", () => {
    const ctx = buildSessionContext(payload({ hook_event_name: "SessionStart", model: "claude-opus-4-8" }), config, {
      now: NOW,
      activityEpisodeId: episodeIdOf("sess_a"),
      branch: "feat/x",
      repository: { provider: "github", id: "acme/app" },
    });
    expect(ctx.sessionId).toBe("sess_a");
    expect(ctx.initiatedBy).toEqual({ type: "user", id: "usr_dev" });
    expect(ctx.agentActor).toEqual({ type: "ai_agent", id: "agent_cc" });
    expect(ctx.agent).toEqual({ name: "claude-code" });
    expect(ctx.model).toEqual({ provider: "anthropic", name: "claude-opus-4-8" });
    expect(ctx.occurredAt).toBe(NOW);
    expect(ctx.branch).toBe("feat/x");
    expect(ctx.repository).toEqual({ provider: "github", id: "acme/app" });
    expect(ctx.scope.tenantId).toBe("local");
    expect(ctx.activityEpisodeId).toBe("ep_sess_a");
  });
});

describe("episodeIdOf", () => {
  test("derives a stable, sanitized activity-episode id from the session id", () => {
    expect(episodeIdOf("sess_a")).toBe("ep_sess_a");
    expect(episodeIdOf("a/b:c")).toBe("ep_a_b_c");
  });
});

describe("promptHashOf", () => {
  test("hashes the prompt and never carries the raw text", () => {
    const hash = promptHashOf(payload({ hook_event_name: "UserPromptSubmit", prompt: "delete prod database" }));
    expect(hash.startsWith("sha256:")).toBe(true);
    expect(hash).not.toContain("delete prod database");
  });
});

describe("buildToolCall", () => {
  test("non-edit tool: tool call only, input hashed, no file change", () => {
    const { toolCall, fileChange } = buildToolCall(
      payload({ tool_name: "Bash", tool_input: { command: "rm -rf build" } }),
      config,
      { seq: 0, now: NOW, status: "succeeded", preImages: {}, afterHashes: {} },
    );
    expect(toolCall.toolCallId).toBe("tc_sess_a_0");
    expect(toolCall.tool).toBe("Bash");
    expect(toolCall.status).toBe("succeeded");
    expect(toolCall.inputHash?.startsWith("sha256:")).toBe(true);
    expect(toolCall.modifies).toBeUndefined();
    expect(fileChange).toBeUndefined();
  });

  test("edit tool emits a file change with before/after on the change, NOT on the tool call", () => {
    const fp = "/repo/src/app.ts";
    const { toolCall, fileChange } = buildToolCall(
      payload({ tool_name: "Edit", tool_input: { file_path: fp, old_string: "a", new_string: "b" } }),
      config,
      {
        seq: 2,
        now: NOW,
        status: "succeeded",
        preImages: { [fp]: "sha256:before" },
        afterHashes: { [fp]: "sha256:after" },
      },
    );
    // The tool_call --modified--> file edge must be emitted exactly once (via the
    // file change), so the tool call itself carries no modifies.
    expect(toolCall.modifies).toBeUndefined();
    expect(fileChange).toBeDefined();
    expect(fileChange?.changedBy).toEqual({ type: "tool_call", id: "tc_sess_a_2" });
    expect(fileChange?.files).toHaveLength(1);
    expect(fileChange?.files[0]).toMatchObject({
      beforeHash: "sha256:before",
      afterHash: "sha256:after",
      action: "upsert",
    });
  });

  test("Write with no pre-image is recorded as a create", () => {
    const fp = "/repo/new.ts";
    const { fileChange } = buildToolCall(
      payload({ tool_name: "Write", tool_input: { file_path: fp, content: "x" } }),
      config,
      { seq: 1, now: NOW, status: "succeeded", preImages: {}, afterHashes: { [fp]: "sha256:after" } },
    );
    expect(fileChange?.files[0]?.action).toBe("create");
    expect(fileChange?.files[0]?.beforeHash).toBeUndefined();
  });

  test("a failed tool call carries failed status", () => {
    const { toolCall } = buildToolCall(payload({ tool_name: "Bash", tool_input: {} }), config, {
      seq: 0,
      now: NOW,
      status: "failed",
      preImages: {},
      afterHashes: {},
    });
    expect(toolCall.status).toBe("failed");
  });
});

describe("buildBashFileChange", () => {
  test("builds a change for git-detected files, null when none", () => {
    expect(buildBashFileChange([], config, { now: NOW, turn: 1, sessionId: "sess_a" })).toBeNull();
    const fc = buildBashFileChange([{ pathHash: "sha256:p1", afterHash: "sha256:a1", action: "upsert" }], config, {
      now: NOW,
      turn: 1,
      sessionId: "sess_a",
    });
    expect(fc?.files).toHaveLength(1);
    expect(fc?.files[0]?.pathHash).toBe("sha256:p1");
    expect(fc?.changedBy).toBeUndefined(); // attributed to the session entity
  });

  // Regression: the recorder's DEFAULT filechange id is constant per source
  // tree, so relying on it collided every later turn-scan in a tenant onto one
  // ingest idempotency key (same key, different bytes -> whole batch 409s).
  // The id must be unique per (session, turn) yet stable for a replayed Stop.
  test("filechange id is unique per session and turn, stable on replay", () => {
    const files = [{ pathHash: "sha256:p1", afterHash: "sha256:a1", action: "upsert" as const }];
    const a1 = buildBashFileChange(files, config, { now: NOW, turn: 1, sessionId: "sess_a" });
    const a1Replay = buildBashFileChange(files, config, { now: NOW, turn: 1, sessionId: "sess_a" });
    const a2 = buildBashFileChange(files, config, { now: NOW, turn: 2, sessionId: "sess_a" });
    const b1 = buildBashFileChange(files, config, { now: NOW, turn: 1, sessionId: "sess_b" });
    expect(a1?.id).toBeDefined();
    expect(a1?.id).toStartWith("evt_");
    expect(a1?.id).toBe(a1Replay?.id as string);
    expect(a1?.id).not.toBe(a2?.id as string);
    expect(a1?.id).not.toBe(b1?.id as string);
  });
});

describe("buildToolCall filechange id", () => {
  const fp = "/tmp/e.txt";
  const edit = (sessionId: string, seq: number) =>
    buildToolCall(payload({ session_id: sessionId, tool_name: "Edit", tool_input: { file_path: fp } }), config, {
      seq,
      now: NOW,
      status: "succeeded",
      preImages: { [fp]: "sha256:before" },
      afterHashes: { [fp]: "sha256:after" },
    });

  // Same collision regression as the turn-scan: each edit's filechange must own
  // a distinct id (scoped to its tool call), not the recorder's constant default.
  test("filechange id is unique per tool call, stable on replay", () => {
    const a0 = edit("sess_a", 0);
    const a0Replay = edit("sess_a", 0);
    const a1 = edit("sess_a", 1);
    const b0 = edit("sess_b", 0);
    expect(a0.fileChange?.id).toBeDefined();
    expect(a0.fileChange?.id).toStartWith("evt_");
    expect(a0.fileChange?.id).toBe(a0Replay.fileChange?.id as string);
    expect(a0.fileChange?.id).not.toBe(a1.fileChange?.id as string);
    expect(a0.fileChange?.id).not.toBe(b0.fileChange?.id as string);
  });
});
