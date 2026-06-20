import { createHash } from "node:crypto";

/**
 * Redaction primitives for the hook. Raw prompts, tool inputs (which may carry
 * Bash commands, MCP arguments, secrets, tokens), and file contents/diffs must
 * NEVER travel to a sink — only their content hashes and stable ids do. Hashing
 * is deterministic and one-way (`.claude/rules/03-privacy-security.md`).
 */

/** Deterministic, prefixed sha256 of a UTF-8 string. */
export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** Stable hash of an arbitrary JSON value (e.g. a tool input) — never its raw form. */
export function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value ?? null));
}

/** A short, stable file-entity id derived from a path hash (the path itself is never stored). */
export function pathEntityId(pathHash: string): string {
  return `f_${pathHash.replace(/^sha256:/, "").slice(0, 16)}`;
}
