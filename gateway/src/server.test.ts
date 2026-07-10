import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAuditRecords } from "@veritio/core";
import { createFileEvidenceStore } from "@veritio/storage";
import { hashPresentedKey } from "./keys";
import { startGateway, type StartedGateway } from "./server";

const PRESENTED_KEY = "vk_e2e_0123456789abcdef";
const stops: (() => void)[] = [];

afterAll(() => {
  for (const stop of stops) stop();
});

/** Mock Anthropic upstream: JSON for non-stream, SSE with usage for stream. */
function startMockProvider(): { port: number; stop(): void } {
  const server = Bun.serve({
    port: 0,
    async fetch(req: Request): Promise<Response> {
      const body = (await req.json()) as { stream?: boolean };
      if (body.stream === true) {
        const frames =
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n' +
          'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n' +
          'event: message_stop\ndata: {"type":"message_stop"}\n\n';
        return new Response(frames, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify({ id: "msg_e2e", usage: { input_tokens: 10, output_tokens: 7 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return {
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}

interface E2e {
  gateway: StartedGateway;
  configPath: string;
  evidenceDir: string;
  configRaw: Record<string, unknown>;
}

async function startE2e(): Promise<E2e> {
  const dir = mkdtempSync(join(tmpdir(), "veritio-gateway-e2e-"));
  const evidenceDir = join(dir, "evidence");
  const provider = startMockProvider();
  stops.push(provider.stop);
  const configRaw = {
    tenantId: "tenant_e2e",
    gatewayId: "gw_e2e",
    evidenceDir,
    providers: {
      anthropic: { baseUrl: `http://127.0.0.1:${provider.port}`, apiKey: "sk-ant-e2e-real" },
    },
    policies: {
      default: { providers: ["anthropic"], models: ["claude-sonnet-*"], endpoints: ["messages"] },
    },
    keys: [{ keyId: "vk_e2e", keyHash: hashPresentedKey(PRESENTED_KEY), policy: "default" }],
  };
  const configPath = join(dir, "veritio-gateway.json");
  writeFileSync(configPath, JSON.stringify(configRaw));
  const gateway = await startGateway({
    configPath,
    port: 0,
    retryIntervalMs: 60_000,
    installSignalHandlers: false,
  });
  stops.push(gateway.stop);
  return { gateway, configPath, evidenceDir, configRaw };
}

describe("gateway e2e over real HTTP", () => {
  test("non-streaming and streaming round trips leave a verifiable evidence chain", async () => {
    const e2e = await startE2e();
    const base = `http://127.0.0.1:${e2e.gateway.port}`;

    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);

    const plain = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": PRESENTED_KEY },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 16 }),
    });
    expect(plain.status).toBe(200);
    expect((await plain.json()).id).toBe("msg_e2e");

    const streamed = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": PRESENTED_KEY },
      body: JSON.stringify({ model: "claude-sonnet-5", stream: true }),
    });
    expect(streamed.status).toBe(200);
    const streamedText = await streamed.text();
    expect(streamedText).toContain("message_stop");

    // Streaming evidence records asynchronously after the body completes.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const store = createFileEvidenceStore(e2e.evidenceDir);
    const records = await store.listEvents();
    expect(records).toHaveLength(2);
    expect(verifyAuditRecords(records)).toEqual({ ok: true });
    expect(records.every((r) => r.event.action === "ai.request.completed")).toBe(true);
    const streamedEvent = records.find((r) => r.event.metadata.stream === true);
    expect(streamedEvent?.event.metadata.usage).toEqual({ input: 10, output: 7 });
    // The real provider key must never appear anywhere in persisted evidence.
    expect(JSON.stringify(records)).not.toContain("sk-ant-e2e-real");
  });

  test("reload picks up a revoked key without restart", async () => {
    const e2e = await startE2e();
    const base = `http://127.0.0.1:${e2e.gateway.port}`;

    const before = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": PRESENTED_KEY },
      body: JSON.stringify({ model: "claude-sonnet-5" }),
    });
    expect(before.status).toBe(200);

    const keys = e2e.configRaw.keys as Record<string, unknown>[];
    keys[0]!.revoked = true;
    writeFileSync(e2e.configPath, JSON.stringify(e2e.configRaw));
    await e2e.gateway.reload();

    const after = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": PRESENTED_KEY },
      body: JSON.stringify({ model: "claude-sonnet-5" }),
    });
    expect(after.status).toBe(401);
    expect((await after.json()).error.type).toBe("revoked_key");
  });

  test("a broken reload keeps the previous config serving", async () => {
    const e2e = await startE2e();
    const base = `http://127.0.0.1:${e2e.gateway.port}`;

    writeFileSync(e2e.configPath, "{broken json");
    await e2e.gateway.reload();

    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": PRESENTED_KEY },
      body: JSON.stringify({ model: "claude-sonnet-5" }),
    });
    expect(res.status).toBe(200);
  });
});
