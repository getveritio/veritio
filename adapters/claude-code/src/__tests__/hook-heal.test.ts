import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end regression for the state-loss self-heal: a session whose state
 * file disappears mid-flight (SessionEnd fired at a continuation boundary,
 * crash, cleanup) must KEEP capturing. Before the heal, every later hook
 * loaded `context: null`, broke out of the switch, and the session went
 * silent forever; worse, a naive rebuild with a fresh `occurredAt` made the
 * deterministic session-start replay an idempotency CONFLICT that rejected
 * whole batches. Spawns the real hook entrypoint against a temp local store —
 * no ingest env, so nothing leaves the machine.
 */
const HOOK = join(import.meta.dir, "..", "hook.ts");
const SESSION = "sess_heal_e2e";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "veritio-heal-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the hook binary once with the given payload against the temp store. */
function runHook(payload: Record<string, unknown>): { status: number | null; stderr: string } {
  const result = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, VERITIO_LOCAL_DIR: dir, VERITIO_INGEST_URL: "", VERITIO_INGEST_KEY: "" },
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

/** Parses the temp store's events.jsonl into AuditEvent payloads. */
function storedEvents(): { action: string; occurredAt: string; target: { id: string } }[] {
  const path = join(dir, "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(
      (line) => (JSON.parse(line) as { event: { action: string; occurredAt: string; target: { id: string } } }).event,
    );
}

describe("hook state-loss self-heal", () => {
  test("keeps capturing after the state file vanishes, without a replay conflict", () => {
    const start = runHook({ hook_event_name: "SessionStart", session_id: SESSION, cwd: dir });
    expect(start.status).toBe(0);
    const originalStart = storedEvents().find((event) => event.action === "agent.session.started");
    expect(originalStart).toBeDefined();

    // The failure mode: state cleared while the session keeps running.
    unlinkSync(join(dir, "state", `${SESSION}.json`));

    const post = runHook({
      hook_event_name: "PostToolUse",
      session_id: SESSION,
      cwd: dir,
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      tool_response: { stdout: "hi" },
    });
    expect(post.status).toBe(0);
    expect(post.stderr).not.toContain("conflict");

    const events = storedEvents();
    // Exactly ONE session-start (byte-identical replay, not a duplicate) and
    // the tool call captured — the session survived the state loss.
    const starts = events.filter((event) => event.action === "agent.session.started");
    expect(starts).toHaveLength(1);
    expect(starts[0]!.occurredAt).toBe(originalStart!.occurredAt);
    expect(events.some((event) => event.action === "agent.tool.called")).toBe(true);

    // The heal persisted a context that mirrors the original bytes.
    const state = JSON.parse(readFileSync(join(dir, "state", `${SESSION}.json`), "utf8")) as {
      context: { occurredAt: string } | null;
    };
    expect(state.context?.occurredAt).toBe(originalStart!.occurredAt);
  });

  test("a session with no prior append heals with a fresh context and still captures", () => {
    // No SessionStart ever ran (state AND store empty) — the heal must build a
    // fresh context; there is no earlier append to conflict with.
    const post = runHook({
      hook_event_name: "PostToolUse",
      session_id: SESSION,
      cwd: dir,
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      tool_response: { stdout: "hi" },
    });
    expect(post.status).toBe(0);
    const events = storedEvents();
    expect(events.some((event) => event.action === "agent.session.started")).toBe(true);
    expect(events.some((event) => event.action === "agent.tool.called")).toBe(true);
  });

  test("SessionEnd still clears state without resurrecting a context", () => {
    runHook({ hook_event_name: "SessionStart", session_id: SESSION, cwd: dir });
    const end = runHook({ hook_event_name: "SessionEnd", session_id: SESSION, cwd: dir });
    expect(end.status).toBe(0);
    expect(existsSync(join(dir, "state", `${SESSION}.json`))).toBe(false);
  });
});
