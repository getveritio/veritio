import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { VirtualKeyConfig } from "./config";
import { extractPresentedKey, hashPresentedKey, resolveVirtualKey } from "./keys";

const PRESENTED = "vk_marketing_prod_0123456789abcdef0123456789abcdef";

function keyConfig(overrides: Partial<VirtualKeyConfig> = {}): VirtualKeyConfig {
  return {
    keyId: "vk_marketing_prod",
    keyHash: hashPresentedKey(PRESENTED),
    policy: "default",
    ...overrides,
  };
}

describe("hashPresentedKey", () => {
  test("matches a node:crypto sha256 reference", () => {
    const reference = createHash("sha256").update(PRESENTED, "utf8").digest("hex");
    expect(hashPresentedKey(PRESENTED)).toBe(reference);
  });
});

describe("extractPresentedKey", () => {
  test("prefers x-api-key over authorization", () => {
    const headers = new Headers({ "x-api-key": "vk_a", authorization: "Bearer vk_b" });
    expect(extractPresentedKey(headers)).toBe("vk_a");
  });

  test("falls back to bearer authorization", () => {
    expect(extractPresentedKey(new Headers({ authorization: "Bearer vk_b" }))).toBe("vk_b");
  });

  test("returns null for absent or non-bearer auth", () => {
    expect(extractPresentedKey(new Headers())).toBeNull();
    expect(extractPresentedKey(new Headers({ authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
  });
});

describe("resolveVirtualKey", () => {
  test("resolves a configured key", () => {
    const resolution = resolveVirtualKey(PRESENTED, [keyConfig()]);
    expect(resolution).toEqual({ ok: true, key: keyConfig() });
  });

  test("unknown presented key fails closed", () => {
    expect(resolveVirtualKey("vk_other", [keyConfig()])).toEqual({ ok: false, reason: "unknown_key" });
  });

  test("revoked key is reported as revoked, not unknown", () => {
    const resolution = resolveVirtualKey(PRESENTED, [keyConfig({ revoked: true })]);
    expect(resolution).toEqual({ ok: false, reason: "revoked_key" });
  });
});
