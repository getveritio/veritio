import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HookPayload } from "@veritio/claude-code";

/**
 * Absolute path of the hook binary Claude Code would invoke from settings.json
 * (`node_modules/@veritio/claude-code/dist/hook.js`). Resolved from the package
 * entry so the example exercises the exact artifact a real installation runs.
 */
export function hookBinaryPath(): string {
  const entry = fileURLToPath(import.meta.resolve("@veritio/claude-code"));
  return join(dirname(entry), "hook.js");
}

export interface CaptureEnvironment {
  /** Temp git repository standing in for the project Claude Code works on. */
  repoDir: string;
  /** Temp VERITIO_LOCAL_DIR the hook appends the evidence trail to. */
  localDir: string;
  /** The file the simulated Edit tool modifies. */
  editedFile: string;
}

/**
 * Creates an isolated project repo + evidence directory so the simulation never
 * touches the host machine's real `~/.veritio/claude-code` store or git state.
 */
export function createCaptureEnvironment(): CaptureEnvironment {
  const root = mkdtempSync(join(tmpdir(), "veritio-claude-code-capture-"));
  const repoDir = join(root, "project");
  const localDir = join(root, "evidence");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(localDir, { recursive: true });

  const editedFile = join(repoDir, "billing.ts");
  writeFileSync(editedFile, "export const plan = 'starter';\n");
  execFileSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: repoDir });
  execFileSync("git", ["-c", "user.email=demo@example.invalid", "-c", "user.name=demo", "add", "."], { cwd: repoDir });
  execFileSync(
    "git",
    ["-c", "user.email=demo@example.invalid", "-c", "user.name=demo", "commit", "--quiet", "-m", "init"],
    { cwd: repoDir },
  );
  return { repoDir, localDir, editedFile };
}

/**
 * Pipes one hook payload into the real hook process with the same stdin/env
 * contract Claude Code uses. Fails loudly on a non-zero exit even though the
 * hook itself is designed to always exit 0, so a broken simulation cannot be
 * mistaken for a passing capture.
 */
export function sendHookEvent(env: CaptureEnvironment, payload: HookPayload): void {
  const result = spawnSync("bun", [hookBinaryPath()], {
    cwd: env.repoDir,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      VERITIO_LOCAL_DIR: env.localDir,
      VERITIO_TENANT_ID: "org_capture_demo",
      VERITIO_ACTOR_ID: "usr_demo_engineer",
      VERITIO_AGENT_ACTOR_ID: "agent_claude_code",
      VERITIO_ENVIRONMENT: "development",
    },
  });
  if (result.status !== 0) {
    throw new Error(`hook exited ${result.status}: ${result.stderr}`);
  }
}

/**
 * Replays one Claude Code turn against the hook: session start, a prompt (raw
 * text hashed, never stored), an Edit tool call with pre/post content hashes, a
 * Stop turn-scan, and session end. Returns the ids the queries key on.
 */
export function simulateSession(env: CaptureEnvironment, opts: { sessionId: string; prompt: string }): void {
  const base = { session_id: opts.sessionId, cwd: env.repoDir };

  sendHookEvent(env, { ...base, hook_event_name: "SessionStart", model: "claude-fable-5" });
  sendHookEvent(env, { ...base, hook_event_name: "UserPromptSubmit", prompt: opts.prompt });
  sendHookEvent(env, {
    ...base,
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: env.editedFile },
  });
  writeFileSync(env.editedFile, "export const plan = 'enterprise';\n");
  sendHookEvent(env, {
    ...base,
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: env.editedFile },
  });
  sendHookEvent(env, { ...base, hook_event_name: "Stop" });
  sendHookEvent(env, { ...base, hook_event_name: "SessionEnd" });
}
