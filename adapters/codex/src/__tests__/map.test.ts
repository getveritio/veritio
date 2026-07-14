import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvenanceRecorder, verifyAuditRecords } from "@veritio/core";
import { createFileEvidenceStore } from "@veritio/storage";
import { resolveConfig } from "../config.js";
import { buildSessionContext, type CodexNotifyPayload, promptHashOf, sessionIdOf, sha256, turnIdOf } from "../map.js";

const CONFIG = resolveConfig({ VERITIO_TENANT_ID: "tenant_codex", VERITIO_ACTOR_ID: "yan" });

function payload(overrides: Partial<CodexNotifyPayload> = {}): CodexNotifyPayload {
  return { type: "agent-turn-complete", "turn-id": "turn_abc", "input-messages": ["do the thing"], ...overrides };
}

describe("codex notify mapping", () => {
  test("tolerates hyphen and snake_case turn-id spellings", () => {
    expect(turnIdOf({ "turn-id": "a" })).toBe("a");
    expect(turnIdOf({ turn_id: "b" })).toBe("b");
    expect(turnIdOf({})).toBe("unknown");
  });

  test("session id is deterministic from the turn id (idempotent replay)", () => {
    expect(sessionIdOf(payload())).toBe(sessionIdOf(payload()));
    expect(sessionIdOf(payload())).toMatch(/^codex_[a-f0-9]{16}$/);
    expect(sessionIdOf(payload({ "turn-id": "other" }))).not.toBe(sessionIdOf(payload()));
  });

  test("prompt is hashed across message spellings, never stored raw", () => {
    const hyphen = promptHashOf(payload({ "input-messages": ["secret prompt"] }));
    const snake = promptHashOf({ input_messages: ["secret prompt"] });
    expect(hyphen).toBe(snake);
    expect(hyphen).toBe(sha256("secret prompt"));
    expect(hyphen).not.toContain("secret prompt");
  });

  test("session context targets the codex agent without leaking content", () => {
    const context = buildSessionContext(payload(), CONFIG, { now: "2026-07-14T10:00:00.000Z" });
    expect(context.agent).toEqual({ name: "codex-cli" });
    expect(context.agentActor).toEqual({ type: "ai_agent", id: "agent_codex" });
    expect(context.scope.tenantId).toBe("tenant_codex");
    expect(JSON.stringify(context)).not.toContain("do the thing");
  });
});

describe("codex notify → recorder → verifiable chain", () => {
  test("records a session + prompt event that verifies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veritio-codex-"));
    const recorder = createProvenanceRecorder(createFileEvidenceStore(dir));
    const now = "2026-07-14T10:00:00.000Z";
    const { session } = await recorder.startSession(buildSessionContext(payload(), CONFIG, { now }));
    await session.recordPrompt({ promptHash: promptHashOf(payload()), occurredAt: now });

    const records = await createFileEvidenceStore(dir).listEvents();
    expect(records.map((r) => r.event.action)).toEqual(["agent.session.started", "agent.prompt.recorded"]);
    expect(verifyAuditRecords(records)).toEqual({ ok: true });
    expect(JSON.stringify(records)).not.toContain("do the thing");
  });
});
