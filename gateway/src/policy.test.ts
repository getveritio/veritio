import { describe, expect, test } from "bun:test";
import type { PolicyConfig } from "./config";
import { decide, matchesModel, type PolicyContext } from "./policy";

const POLICY: PolicyConfig = {
  providers: ["anthropic"],
  models: ["claude-sonnet-*", "claude-haiku-4-5-20251001"],
  endpoints: ["messages"],
};

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    keyId: "vk_demo",
    provider: "anthropic",
    model: "claude-sonnet-5",
    endpoint: "messages",
    ...overrides,
  };
}

describe("matchesModel", () => {
  test("exact match", () => {
    expect(matchesModel("claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001")).toBe(true);
    expect(matchesModel("claude-haiku-4-5-20251001", "claude-haiku-4-5")).toBe(false);
  });

  test("trailing-* prefix match", () => {
    expect(matchesModel("claude-sonnet-*", "claude-sonnet-5")).toBe(true);
    expect(matchesModel("claude-sonnet-*", "claude-haiku-4-5")).toBe(false);
  });

  test("bare * is the only match-all; inner * stays literal", () => {
    expect(matchesModel("*", "anything")).toBe(true);
    expect(matchesModel("claude-*-5", "claude-sonnet-5")).toBe(false);
  });
});

describe("decide", () => {
  test("allows a fully matching request", () => {
    expect(decide(ctx(), POLICY)).toEqual({ allow: true });
  });

  test("missing policy denies", () => {
    expect(decide(ctx(), undefined)).toEqual({ allow: false, reason: "missing_policy" });
  });

  test("unmapped endpoint (null) denies before anything else", () => {
    expect(decide(ctx({ endpoint: null, model: null }), POLICY)).toEqual({
      allow: false,
      reason: "endpoint_not_allowed",
    });
  });

  test("endpoint not in allowlist denies", () => {
    expect(decide(ctx({ endpoint: "chat-completions" }), POLICY)).toEqual({
      allow: false,
      reason: "endpoint_not_allowed",
    });
  });

  test("provider not in allowlist denies", () => {
    expect(decide(ctx({ provider: "openai", endpoint: "messages" }), POLICY)).toEqual({
      allow: false,
      reason: "provider_not_allowed",
    });
  });

  test("unparseable model denies (fail closed, never forward)", () => {
    expect(decide(ctx({ model: null }), POLICY)).toEqual({ allow: false, reason: "unparseable_body" });
  });

  test("model outside allowlist denies", () => {
    expect(decide(ctx({ model: "claude-opus-4-8" }), POLICY)).toEqual({
      allow: false,
      reason: "model_not_allowed",
    });
  });
});
