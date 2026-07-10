import { describe, expect, test } from "bun:test";
import { anthropicRequest, harness, PRESENTED_KEY, PROVIDER_KEY_ANTHROPIC, testConfig } from "../test/harness";

describe("gateway handler — routing and auth", () => {
  test("unmapped path is 404 with no evidence and no upstream call", async () => {
    const h = harness();
    const res = await h.handle(new Request("https://gateway.test/v1/embeddings", { method: "POST" }));
    expect(res.status).toBe(404);
    expect(h.events).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  test("missing or unknown key → 401 denied evidence, upstream never called", async () => {
    const h = harness();
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5" }, { "x-api-key": "vk_wrong" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { type: "unknown_key", reason: "unknown_key" } });
    expect(h.calls).toHaveLength(0);
    expect(h.events).toHaveLength(1);
    const event = h.events[0]!;
    expect(event.action).toBe("ai.request.denied");
    expect(event.actor).toEqual({ type: "service", id: "unknown" });
  });

  test("revoked key → 401 with revoked reason", async () => {
    const config = testConfig();
    config.keys[0]!.revoked = true;
    const h = harness({ config });
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.type).toBe("revoked_key");
  });
});

describe("gateway handler — policy", () => {
  test("model outside allowlist → 403 with deny evidence", async () => {
    const h = harness();
    const res = await h.handle(anthropicRequest({ model: "claude-opus-4-8" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { type: "policy_denied", reason: "model_not_allowed" } });
    expect(h.calls).toHaveLength(0);
    expect(h.events[0]!.metadata?.denyReason).toBe("model_not_allowed");
    expect(h.events[0]!.metadata?.policyDecision).toBe("deny");
  });

  test("unparseable body → 403 unparseable_body, upstream never called", async () => {
    const h = harness();
    const res = await h.handle(anthropicRequest("{not json"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("unparseable_body");
    expect(h.calls).toHaveLength(0);
  });
});

describe("gateway handler — non-streaming forward", () => {
  test("happy path: verbatim body back, completed evidence with usage and cost", async () => {
    const h = harness();
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5", max_tokens: 128 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "msg", usage: { input_tokens: 412, output_tokens: 57 } });

    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    expect(call.url).toBe("https://anthropic.upstream.test/v1/messages");
    expect(call.headers.get("x-api-key")).toBe(PROVIDER_KEY_ANTHROPIC);
    expect(call.bodyText).toBe(JSON.stringify({ model: "claude-sonnet-5", max_tokens: 128 }));

    expect(h.events).toHaveLength(1);
    const event = h.events[0]!;
    expect(event.action).toBe("ai.request.completed");
    expect(event.target).toEqual({ type: "model", id: "anthropic:claude-sonnet-5" });
    const metadata = event.metadata ?? {};
    expect(metadata.usage).toEqual({ input: 412, output: 57 });
    // 412×3.0 + 57×15.0 μUSD/tok = 1236 + 855
    expect(metadata.costMicroUsd).toBe(2091);
    expect(metadata.costBasis).toBe("provider_reported");
    expect(typeof metadata.requestBodyHash).toBe("string");
    expect(typeof metadata.responseBodyHash).toBe("string");
  });

  test("presented virtual key never reaches the upstream request", async () => {
    const h = harness();
    await h.handle(anthropicRequest({ model: "claude-sonnet-5" }));
    const call = h.calls[0]!;
    call.headers.forEach((value) => expect(value).not.toContain(PRESENTED_KEY));
  });

  test("real provider key never appears in evidence or error bodies", async () => {
    const h = harness({ respond: () => new Response("upstream error", { status: 500 }) });
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5" }));
    expect(res.status).toBe(500);
    const everything = JSON.stringify(h.events) + (await res.text());
    expect(everything).not.toContain(PROVIDER_KEY_ANTHROPIC);
  });

  test("upstream non-2xx passes through verbatim and records ai.request.failed", async () => {
    const h = harness({
      respond: () =>
        new Response(JSON.stringify({ error: { type: "overloaded_error" } }), {
          status: 529,
          headers: { "content-type": "application/json" },
        }),
    });
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5" }));
    expect(res.status).toBe(529);
    expect(h.events[0]!.action).toBe("ai.request.failed");
    expect(h.events[0]!.metadata?.status).toBe(529);
  });

  test("upstream network failure → sanitized 502 + failed evidence", async () => {
    const h = harness({
      respond: () => {
        throw new Error("ECONNREFUSED 10.0.0.1:443 secret-internal-host");
      },
    });
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5" }));
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).not.toContain("secret-internal-host");
    expect(h.events[0]!.action).toBe("ai.request.failed");
    expect(h.events[0]!.metadata?.status).toBe(502);
  });

  test("content hashes omitted when captureContentHashes is off", async () => {
    const h = harness({ config: testConfig({ captureContentHashes: false }) });
    await h.handle(anthropicRequest({ model: "claude-sonnet-5" }));
    const metadata = h.events[0]!.metadata ?? {};
    expect("requestBodyHash" in metadata).toBe(false);
    expect("responseBodyHash" in metadata).toBe(false);
  });

  test("evidence sink failure is routed to health, not thrown", async () => {
    const h = harness({
      evidence: {
        record: () => Promise.reject(new Error("disk full")),
      },
    });
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5" }));
    expect(res.status).toBe(200);
    expect(h.health.failures).toHaveLength(1);
    expect(h.health.failures[0]!.kind).toBe("completed");
  });

  test("unhealthy gateway 503s before any upstream contact", async () => {
    const h = harness();
    h.health.healthy = false;
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.type).toBe("evidence_unavailable");
    expect(h.calls).toHaveLength(0);
  });
});

describe("gateway handler — openai surface", () => {
  test("openai request uses bearer auth and the openai base URL", async () => {
    const config = testConfig();
    config.keys[0]!.policy = "openai";
    const h = harness({
      config,
      respond: () =>
        new Response(JSON.stringify({ id: "c", usage: { prompt_tokens: 88, completion_tokens: 41 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const res = await h.handle(
      new Request("https://gateway.test/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${PRESENTED_KEY}` },
        body: JSON.stringify({ model: "gpt-5.2" }),
      }),
    );
    expect(res.status).toBe(200);
    const call = h.calls[0]!;
    expect(call.url).toBe("https://openai.upstream.test/v1/chat/completions");
    expect(call.headers.get("authorization")).toBe("Bearer sk-openai-real-provider-key");
    expect(h.events[0]!.metadata?.costMicroUsd).toBe(Math.round(88 * 1.25) + 41 * 10);
  });
});
