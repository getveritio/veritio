import { describe, expect, test } from "bun:test";
import { GatewayConfigError, parseGatewayConfig } from "./config";

const KEY_HASH = "a".repeat(64);

/** Minimal valid raw config used as the mutation base for failure cases. */
function validRaw(): Record<string, unknown> {
  return {
    tenantId: "tenant_demo",
    gatewayId: "gw_demo",
    evidenceDir: "/var/lib/veritio-gateway/evidence",
    providers: {
      anthropic: { baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-secret-value" },
    },
    policies: {
      default: { providers: ["anthropic"], models: ["claude-sonnet-*"], endpoints: ["messages"] },
    },
    keys: [{ keyId: "vk_demo", keyHash: KEY_HASH, policy: "default" }],
  };
}

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof GatewayConfigError) return error.field;
    throw error;
  }
  throw new Error("expected GatewayConfigError");
}

describe("parseGatewayConfig", () => {
  test("parses a valid config and applies defaults", () => {
    const config = parseGatewayConfig(validRaw());
    expect(config.tenantId).toBe("tenant_demo");
    expect(config.evidenceFailureMode).toBe("block");
    expect(config.captureContentHashes).toBe(true);
    expect(config.injectStreamUsage).toBe(true);
    expect(config.keys[0]?.policy).toBe("default");
  });

  test("fails closed on each missing required field", () => {
    for (const field of ["tenantId", "gatewayId", "evidenceDir"]) {
      const raw = validRaw();
      delete raw[field];
      expect(fieldOf(() => parseGatewayConfig(raw))).toBe(field);
    }
  });

  test("rejects unknown evidenceFailureMode", () => {
    const raw = validRaw();
    raw.evidenceFailureMode = "ignore";
    expect(fieldOf(() => parseGatewayConfig(raw))).toBe("evidenceFailureMode");
  });

  test("rejects non-hex keyHash", () => {
    const raw = validRaw();
    (raw.keys as Record<string, unknown>[])[0]!.keyHash = "not-hex";
    expect(fieldOf(() => parseGatewayConfig(raw))).toBe("keys[0].keyHash");
  });

  test("rejects duplicate keyId", () => {
    const raw = validRaw();
    const keys = raw.keys as Record<string, unknown>[];
    keys.push({ ...keys[0] });
    expect(fieldOf(() => parseGatewayConfig(raw))).toBe("keys[1].keyId");
  });

  test("rejects key referencing unknown policy", () => {
    const raw = validRaw();
    (raw.keys as Record<string, unknown>[])[0]!.policy = "missing";
    expect(fieldOf(() => parseGatewayConfig(raw))).toBe("keys[0].policy");
  });

  test("rejects policy referencing unconfigured provider", () => {
    const raw = validRaw();
    (raw.policies as Record<string, Record<string, unknown>>).default!.providers = ["openai"];
    expect(fieldOf(() => parseGatewayConfig(raw))).toBe("policies.default.providers");
  });

  test("rejects unknown provider name and unknown endpoint", () => {
    const raw = validRaw();
    (raw.providers as Record<string, unknown>).mistral = { baseUrl: "https://x", apiKey: "k" };
    expect(fieldOf(() => parseGatewayConfig(raw))).toBe("providers.mistral");

    const raw2 = validRaw();
    (raw2.policies as Record<string, Record<string, unknown>>).default!.endpoints = ["completions-legacy"];
    expect(fieldOf(() => parseGatewayConfig(raw2))).toBe("policies.default.endpoints");
  });

  test("ingest block is optional but all-or-nothing", () => {
    const withIngest = validRaw();
    withIngest.ingest = { url: "https://console.getveritio.com", key: "vrt_scoped" };
    expect(parseGatewayConfig(withIngest).ingest).toEqual({
      url: "https://console.getveritio.com",
      key: "vrt_scoped",
    });
    expect(parseGatewayConfig(validRaw()).ingest).toBeUndefined();

    const missingKey = validRaw();
    missingKey.ingest = { url: "https://console.getveritio.com" };
    expect(fieldOf(() => parseGatewayConfig(missingKey))).toBe("ingest.key");
  });

  test("never echoes config values in error messages", () => {
    const raw = validRaw();
    (raw.providers as Record<string, Record<string, unknown>>).anthropic!.baseUrl = "";
    try {
      parseGatewayConfig(raw);
      throw new Error("expected throw");
    } catch (error) {
      expect(String(error)).not.toContain("sk-ant-secret-value");
    }
  });
});
