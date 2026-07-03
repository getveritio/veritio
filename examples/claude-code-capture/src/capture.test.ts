import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exportSession, getSession, listSessions, sha256 } from "@veritio/claude-code";
import { createFileEvidenceStore } from "@veritio/storage";
import { createCaptureEnvironment, simulateSession } from "./capture";

const SESSION_ID = "sess-capture-demo-01";
const RAW_PROMPT = "Refactor billing and rotate the key TOP-SECRET-ROTATE-ME-9000";

/** Recursively reads every evidence file so redaction can be proven on raw bytes. */
function readAllEvidenceBytes(dir: string): string {
  let bytes = "";
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      bytes += readFileSync(join(entry.parentPath, entry.name), "utf8");
    }
  }
  return bytes;
}

describe("claude-code capture via the real hook binary", () => {
  const env = createCaptureEnvironment();
  simulateSession(env, { sessionId: SESSION_ID, prompt: RAW_PROMPT });
  const store = createFileEvidenceStore(env.localDir);

  test("the session is captured and listed with its agent/model identity", async () => {
    const sessions = await listSessions(store);
    const summary = sessions.find((s) => s.sessionId === SESSION_ID);
    expect(summary).toBeDefined();
    expect(summary?.model).toEqual({ provider: "anthropic", name: "claude-fable-5" });
  });

  test("prompt and tool activity are recorded as hashes with a provenance graph", async () => {
    const session = await getSession(store, SESSION_ID);
    const actions = session.events.map((r) => r.event.action);
    expect(actions).toContain("agent.session.started");
    expect(actions).toContain("agent.prompt.recorded");
    expect(actions).toContain("agent.tool.called");
    expect(actions).toContain("change.files.changed");

    const prompt = session.events.find((r) => r.event.action === "agent.prompt.recorded");
    expect(prompt?.event.metadata.promptHash).toBe(sha256(RAW_PROMPT));
    expect(prompt?.event.metadata.sessionId).toBe(SESSION_ID);
  });

  test("raw prompt text never reaches the evidence store", () => {
    const bytes = readAllEvidenceBytes(env.localDir);
    expect(bytes).not.toContain("TOP-SECRET-ROTATE-ME-9000");
    expect(bytes).toContain(sha256(RAW_PROMPT));
  });

  test("the exported bundle's hash chains verify", async () => {
    const bundle = await exportSession(store, SESSION_ID);
    expect(bundle.verification.ok).toBe(true);
    expect(bundle.events.length).toBeGreaterThanOrEqual(4);
  });
});
