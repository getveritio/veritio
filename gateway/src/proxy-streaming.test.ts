import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicRequest, harness, PRESENTED_KEY, testConfig } from "../test/harness";

const FIXTURES = join(import.meta.dir, "..", "test", "fixtures");
const anthropicStream = readFileSync(join(FIXTURES, "anthropic-stream.txt"), "utf8");
const openaiStream = readFileSync(join(FIXTURES, "openai-stream.txt"), "utf8");

/** Streams `text` in small chunks to exercise chunk-boundary handling. */
function sseResponse(text: string, chunkSize = 48): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < text.length; i += chunkSize) {
        controller.enqueue(encoder.encode(text.slice(i, i + chunkSize)));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("gateway handler — streaming", () => {
  test("anthropic SSE passes through byte-identical and meters from the tee", async () => {
    const h = harness({ respond: () => sseResponse(anthropicStream) });
    const res = await h.handle(anthropicRequest({ model: "claude-sonnet-5", stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe(anthropicStream);

    await h.settle();
    expect(h.events).toHaveLength(1);
    const metadata = h.events[0]!.metadata ?? {};
    expect(h.events[0]!.action).toBe("ai.request.completed");
    expect(metadata.stream).toBe(true);
    expect(metadata.usage).toEqual({ input: 412, output: 57 });
    expect(metadata.costMicroUsd).toBe(2091);
    expect(typeof metadata.responseBodyHash).toBe("string");
  });

  test("anthropic streaming request body is forwarded unmodified (no injection)", async () => {
    const h = harness({ respond: () => sseResponse(anthropicStream) });
    const body = { model: "claude-sonnet-5", stream: true, max_tokens: 64 };
    await h.handle(anthropicRequest(body));
    await h.settle();
    expect(h.calls[0]!.bodyText).toBe(JSON.stringify(body));
    expect("mutatedRequest" in (h.events[0]!.metadata ?? {})).toBe(false);
  });

  test("openai streaming gets include_usage injected and recorded as mutatedRequest", async () => {
    const config = testConfig();
    config.keys[0]!.policy = "openai";
    const h = harness({ config, respond: () => sseResponse(openaiStream) });
    const res = await h.handle(
      new Request("https://gateway.test/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${PRESENTED_KEY}` },
        body: JSON.stringify({ model: "gpt-5.2", stream: true }),
      }),
    );
    expect(await res.text()).toBe(openaiStream);
    await h.settle();

    const forwarded = JSON.parse(h.calls[0]!.bodyText);
    expect(forwarded.stream_options).toEqual({ include_usage: true });
    const metadata = h.events[0]!.metadata ?? {};
    expect(metadata.mutatedRequest).toBe("inject_stream_usage");
    expect(metadata.usage).toEqual({ input: 88, output: 41 });
  });

  test("openai injection is skipped when the flag is off or stream_options present", async () => {
    const config = testConfig({ injectStreamUsage: false });
    config.keys[0]!.policy = "openai";
    const h = harness({ config, respond: () => sseResponse(openaiStream) });
    const body = { model: "gpt-5.2", stream: true };
    await (
      await h.handle(
        new Request("https://gateway.test/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${PRESENTED_KEY}` },
          body: JSON.stringify(body),
        }),
      )
    ).text();
    await h.settle();
    expect(h.calls[0]!.bodyText).toBe(JSON.stringify(body));

    const config2 = testConfig();
    config2.keys[0]!.policy = "openai";
    const h2 = harness({ config: config2, respond: () => sseResponse(openaiStream) });
    const body2 = { model: "gpt-5.2", stream: true, stream_options: { include_usage: false } };
    await (
      await h2.handle(
        new Request("https://gateway.test/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${PRESENTED_KEY}` },
          body: JSON.stringify(body2),
        }),
      )
    ).text();
    await h2.settle();
    expect(h2.calls[0]!.bodyText).toBe(JSON.stringify(body2));
  });

  test("stream without usage frames records completed with usage omitted", async () => {
    const h = harness({
      respond: () => sseResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
    });
    await (await h.handle(anthropicRequest({ model: "claude-sonnet-5", stream: true }))).text();
    await h.settle();
    const metadata = h.events[0]!.metadata ?? {};
    expect(h.events[0]!.action).toBe("ai.request.completed");
    expect("usage" in metadata).toBe(false);
    expect("costMicroUsd" in metadata).toBe(false);
  });

  test("client abort mid-stream aborts upstream and records status aborted", async () => {
    let upstreamCancelled = false;
    const h = harness({
      respond: (call) => {
        let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            upstreamController = controller;
            controller.enqueue(new TextEncoder().encode("event: message_start\n"));
            // Never closes — the abort must end it.
          },
          cancel() {
            upstreamCancelled = true;
          },
        });
        // Mirror real fetch: aborting the request signal errors in-flight body reads.
        call.signal?.addEventListener("abort", () => {
          upstreamCancelled = true;
          upstreamController?.error(new DOMException("aborted", "AbortError"));
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });

    const clientAbort = new AbortController();
    const req = new Request("https://gateway.test/v1/messages", {
      method: "POST",
      headers: { "x-api-key": PRESENTED_KEY },
      body: JSON.stringify({ model: "claude-sonnet-5", stream: true }),
      signal: clientAbort.signal,
    });
    const res = await h.handle(req);
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    await reader.read(); // first chunk arrives
    clientAbort.abort();
    await reader.cancel().catch(() => {});
    await h.settle();

    expect(upstreamCancelled).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]!.action).toBe("ai.request.failed");
    expect(h.events[0]!.metadata?.status).toBe("aborted");
  });
});
