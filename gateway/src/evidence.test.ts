import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, createAuditEvent, verifyAuditRecords } from "@veritio/core";
import { createFileEvidenceStore } from "@veritio/storage";
import { buildOutcomeEvent, createGatewayEvidence, type RequestOutcome } from "./evidence";

const CFG = { tenantId: "tenant_demo", gatewayId: "gw_demo" };

function completedOutcome(overrides: Partial<RequestOutcome> = {}): RequestOutcome {
  return {
    kind: "completed",
    requestId: "req_01",
    occurredAt: "2026-07-10T12:00:00.000Z",
    keyId: "vk_marketing_prod",
    provider: "anthropic",
    endpoint: "messages",
    model: "claude-sonnet-5",
    stream: false,
    status: 200,
    latencyMs: 840,
    policyDecision: "allow",
    usage: { inputTokens: 412, outputTokens: 57 },
    costMicroUsd: 2091,
    requestBodyHash: "b".repeat(64),
    responseBodyHash: "c".repeat(64),
    ...overrides,
  };
}

/** Metadata keys allowed by spec/ai-gateway-capture.md — nothing else may appear. */
const ALLOWED_METADATA_KEYS = new Set([
  "gatewayId",
  "provider",
  "endpoint",
  "model",
  "stream",
  "status",
  "latencyMs",
  "policyDecision",
  "denyReason",
  "usage",
  "costBasis",
  "costMicroUsd",
  "requestBodyHash",
  "responseBodyHash",
  "mutatedRequest",
]);

describe("buildOutcomeEvent", () => {
  test("completed event satisfies the protocol event contract", () => {
    const input = buildOutcomeEvent(completedOutcome(), CFG);
    const event = createAuditEvent(input); // throws on protocol violations (action pattern, actor shape)
    expect(event.action).toBe("ai.request.completed");
    expect(event.actor).toEqual({ type: "service", id: "vk_marketing_prod" });
    expect(event.target).toEqual({ type: "model", id: "anthropic:claude-sonnet-5" });
    expect(event.requestId).toBe("req_01");
    expect(event.scope).toEqual({ tenantId: "tenant_demo" });
    expect(event.metadata.costBasis).toBe("provider_reported");
  });

  test("metadata contains only the documented key set", () => {
    const input = buildOutcomeEvent(completedOutcome(), CFG);
    for (const key of Object.keys(input.metadata ?? {})) {
      expect(ALLOWED_METADATA_KEYS.has(key)).toBe(true);
    }
  });

  test("denied outcome with unresolved key and unparseable model targets the provider", () => {
    const input = buildOutcomeEvent(
      completedOutcome({
        kind: "denied",
        keyId: null,
        model: null,
        endpoint: null,
        status: 401,
        policyDecision: "deny",
        denyReason: "unknown_key",
        usage: null,
        costMicroUsd: null,
        requestBodyHash: undefined,
        responseBodyHash: undefined,
      }),
      CFG,
    );
    expect(input.action).toBe("ai.request.denied");
    expect(input.actor).toEqual({ type: "service", id: "unknown" });
    expect(input.target).toEqual({ type: "provider", id: "anthropic" });
    const metadata = input.metadata ?? {};
    expect(metadata.denyReason).toBe("unknown_key");
    expect("usage" in metadata).toBe(false);
    expect("model" in metadata).toBe(false);
  });

  test("identical outcomes produce identical canonical events (deterministic)", () => {
    const a = buildOutcomeEvent(completedOutcome(), CFG);
    const b = buildOutcomeEvent(completedOutcome(), CFG);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test("usage omitted entirely when provider reported nothing", () => {
    const input = buildOutcomeEvent(completedOutcome({ usage: null, costMicroUsd: null }), CFG);
    const metadata = input.metadata ?? {};
    expect("usage" in metadata).toBe(false);
    expect("costBasis" in metadata).toBe(false);
    expect("costMicroUsd" in metadata).toBe(false);
  });
});

describe("createGatewayEvidence", () => {
  test("chains outcomes through a real file store and verifies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "veritio-gateway-evidence-"));
    const store = createFileEvidenceStore(dir);
    const evidence = createGatewayEvidence(store, CFG);

    await evidence.record(completedOutcome({ requestId: "req_01" }));
    await evidence.record(
      completedOutcome({
        requestId: "req_02",
        kind: "denied",
        policyDecision: "deny",
        denyReason: "model_not_allowed",
        status: 403,
      }),
    );
    await evidence.record(completedOutcome({ requestId: "req_03", kind: "failed", status: 502 }));

    const records = await store.listEvents();
    expect(records).toHaveLength(3);
    expect(verifyAuditRecords(records)).toEqual({ ok: true });
    expect(records.map((r) => r.event.action)).toEqual([
      "ai.request.completed",
      "ai.request.denied",
      "ai.request.failed",
    ]);
  });
});
