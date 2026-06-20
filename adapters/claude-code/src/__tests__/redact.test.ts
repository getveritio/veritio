import { describe, expect, test } from "bun:test";

import { hashJson, pathEntityId, sha256 } from "../redact";

describe("redact", () => {
  test("sha256 is deterministic, prefixed, and never echoes the input", () => {
    const a = sha256("super-secret-prompt");
    expect(a).toBe(sha256("super-secret-prompt"));
    expect(a.startsWith("sha256:")).toBe(true);
    expect(a).toHaveLength("sha256:".length + 64);
    expect(a).not.toContain("super-secret-prompt");
  });

  test("hashJson hashes structure, never the raw value", () => {
    const secret = { command: "curl -H 'Authorization: Bearer abc123'" };
    const hash = hashJson(secret);
    expect(hash).toBe(hashJson({ command: "curl -H 'Authorization: Bearer abc123'" }));
    expect(hash).not.toContain("abc123");
    expect(hashJson(undefined)).toBe(sha256("null"));
  });

  test("pathEntityId derives a short stable id from a path hash", () => {
    const id = pathEntityId(sha256("/repo/src/app.ts"));
    expect(id.startsWith("f_")).toBe(true);
    expect(id).toBe(pathEntityId(sha256("/repo/src/app.ts")));
  });
});
