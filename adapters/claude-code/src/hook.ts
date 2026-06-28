#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type AuditEvent, type EvidenceEdge, type RecordResult, createProvenanceRecorder } from "@veritio/core";
import { createFileEvidenceStore } from "@veritio/storage";

import { resolveConfig } from "./config";
import { postToIngest } from "./ingest";
import {
  type ChangedFile,
  buildBashFileChange,
  buildSessionContext,
  buildToolCall,
  episodeIdOf,
  promptHashOf,
} from "./map";
import { sha256 } from "./redact";
import { clearState, loadState, saveState } from "./state";
import type { HookPayload } from "./types";

/** Largest file the turn-scan will hash, to keep a Stop hook bounded. */
const MAX_HASH_BYTES = 2_000_000;
const MAX_TURN_FILES = 500;

/**
 * Claude Code hook entrypoint. Reads one hook event from stdin, maps it to
 * Veritio recorder calls against a durable file store (and optionally ships the
 * records to an ingest endpoint), and ALWAYS exits 0 — a logging/observability
 * hook must never block the agent. All raw content is hashed before it leaves.
 */
async function main(): Promise<void> {
  const raw = readStdin();
  if (!raw.trim()) {
    return;
  }
  const payload = JSON.parse(raw) as HookPayload;
  if (!payload.session_id || !payload.hook_event_name) {
    return;
  }

  const config = resolveConfig(process.env);
  const state = loadState(config.localDir, payload.session_id);
  const recorder = createProvenanceRecorder(createFileEvidenceStore(config.localDir));
  const now = new Date().toISOString();
  const events: AuditEvent[] = [];
  const edges: EvidenceEdge[] = [];
  const collect = (result: RecordResult): void => {
    events.push(result.event.event);
    for (const edge of result.edges) {
      edges.push(edge.edge);
    }
  };

  switch (payload.hook_event_name) {
    case "SessionStart": {
      const activityEpisodeId = state.activityEpisodeId ?? episodeIdOf(payload.session_id);
      state.activityEpisodeId = activityEpisodeId;
      state.context = buildSessionContext(payload, config, { now, activityEpisodeId, ...readGit(payload.cwd) });
      const { result } = await recorder.startSession(state.context);
      collect(result);
      break;
    }
    case "UserPromptSubmit": {
      if (!state.context) break;
      const { session } = await recorder.startSession(state.context); // idempotent replay
      collect(await session.recordPrompt({ promptHash: promptHashOf(payload), occurredAt: now }));
      break;
    }
    case "PreToolUse": {
      const filePath = filePathOf(payload);
      const hash = filePath ? hashFile(filePath) : undefined;
      if (filePath && hash) {
        state.preImages[filePath] = hash;
      }
      break;
    }
    case "PostToolUse":
    case "PostToolUseFailure": {
      if (!state.context) break;
      const { session } = await recorder.startSession(state.context);
      const filePath = filePathOf(payload);
      const after = filePath ? hashFile(filePath) : undefined;
      const { toolCall, fileChange } = buildToolCall(payload, config, {
        seq: state.toolSeq,
        now,
        status: payload.hook_event_name === "PostToolUse" ? "succeeded" : "failed",
        preImages: state.preImages,
        afterHashes: filePath && after ? { [filePath]: after } : {},
      });
      collect(await session.recordToolCall(toolCall));
      if (fileChange) {
        collect(await session.recordFileChange(fileChange));
      }
      state.toolSeq += 1;
      if (filePath) {
        delete state.preImages[filePath];
      }
      break;
    }
    case "Stop": {
      if (!state.context) break;
      state.turn += 1;
      const fileChange = buildBashFileChange(gitChangedFiles(payload.cwd), config, { now, turn: state.turn });
      if (fileChange) {
        const { session } = await recorder.startSession(state.context);
        collect(await session.recordFileChange(fileChange));
      }
      break;
    }
    case "SessionEnd": {
      clearState(config.localDir, payload.session_id);
      return;
    }
    default:
      return; // Unknown / non-provenance events are ignored.
  }

  saveState(config.localDir, payload.session_id, state);
  if (config.ingest) {
    await postToIngest(config.ingest, { events, edges });
  }
}

/** Reads all of stdin synchronously; returns "" when there is no piped input. */
function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function filePathOf(payload: HookPayload): string | undefined {
  const value = payload.tool_input?.file_path;
  return typeof value === "string" ? value : undefined;
}

/** Hashes a file's current content, or returns undefined if unreadable/too large. */
function hashFile(path: string): string | undefined {
  try {
    if (statSync(path).size > MAX_HASH_BYTES) {
      return undefined;
    }
    return sha256(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Reads the current branch + origin remote for the SessionStart context (best-effort). */
function readGit(cwd?: string): { branch?: string; repository?: { provider: string; id: string } } {
  const dir = cwd ?? process.cwd();
  const out: { branch?: string; repository?: { provider: string; id: string } } = {};
  try {
    const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (branch) {
      out.branch = branch;
    }
  } catch {
    // not a git repo
  }
  try {
    const remote = git(dir, ["config", "--get", "remote.origin.url"]).trim();
    if (remote) {
      const match = remote.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
      out.repository = { provider: remote.includes("github") ? "github" : "git", id: match?.[1] ?? remote };
    }
  } catch {
    // no remote
  }
  return out;
}

/**
 * Lists files the working tree changed this turn (catches Bash-driven writes that
 * the Edit/Write hooks never see), hashing current content. Bounded + best-effort.
 */
function gitChangedFiles(cwd?: string): ChangedFile[] {
  const dir = cwd ?? process.cwd();
  let porcelain: string;
  try {
    porcelain = git(dir, ["status", "--porcelain"]);
  } catch {
    return [];
  }
  const files: ChangedFile[] = [];
  for (const line of porcelain.split("\n")) {
    if (!line.trim() || files.length >= MAX_TURN_FILES) continue;
    const code = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (!path) continue;
    const pathHash = sha256(path);
    if (code.includes("D")) {
      files.push({ pathHash, afterHash: sha256(""), action: "delete" });
      continue;
    }
    const absolute = isAbsolute(path) ? path : join(dir, path);
    const afterHash = hashFile(absolute);
    if (!afterHash) continue;
    files.push({ pathHash, afterHash, action: code.includes("?") || code.includes("A") ? "create" : "upsert" });
  }
  return files;
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    // Never block the agent: log a sanitized line and exit successfully.
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`veritio-claude-code: ${message}\n`);
    process.exit(0);
  });
