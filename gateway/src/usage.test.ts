import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSseUsageAccumulator, extractJsonUsage } from "./usage";

const FIXTURES = join(import.meta.dir, "..", "test", "fixtures");
const anthropicStream = readFileSync(join(FIXTURES, "anthropic-stream.txt"), "utf8");
const openaiStream = readFileSync(join(FIXTURES, "openai-stream.txt"), "utf8");

describe("extractJsonUsage", () => {
  test("anthropic non-streaming body", () => {
    const body = { id: "msg_01", usage: { input_tokens: 412, output_tokens: 57 } };
    expect(extractJsonUsage("anthropic", body)).toEqual({ inputTokens: 412, outputTokens: 57 });
  });

  test("openai non-streaming body", () => {
    const body = { id: "chatcmpl-01", usage: { prompt_tokens: 88, completion_tokens: 41, total_tokens: 129 } };
    expect(extractJsonUsage("openai", body)).toEqual({ inputTokens: 88, outputTokens: 41 });
  });

  test("missing or malformed usage yields null, never zeros", () => {
    expect(extractJsonUsage("anthropic", { id: "msg" })).toBeNull();
    expect(extractJsonUsage("openai", { usage: { prompt_tokens: "88" } })).toBeNull();
    expect(extractJsonUsage("openai", null)).toBeNull();
  });
});

describe("createSseUsageAccumulator", () => {
  test("anthropic stream: message_start input + latest message_delta output", () => {
    const acc = createSseUsageAccumulator("anthropic");
    acc.feed(anthropicStream);
    expect(acc.usage()).toEqual({ inputTokens: 412, outputTokens: 57 });
  });

  test("openai stream with include_usage final frame", () => {
    const acc = createSseUsageAccumulator("openai");
    acc.feed(openaiStream);
    expect(acc.usage()).toEqual({ inputTokens: 88, outputTokens: 41 });
  });

  test("frames split across arbitrary chunk boundaries still parse", () => {
    const acc = createSseUsageAccumulator("anthropic");
    const mid = anthropicStream.indexOf('"usage":{"input_tokens"') + 10;
    acc.feed(anthropicStream.slice(0, mid));
    acc.feed(anthropicStream.slice(mid));
    expect(acc.usage()).toEqual({ inputTokens: 412, outputTokens: 57 });
  });

  test("stream without usage frames yields null", () => {
    const acc = createSseUsageAccumulator("openai");
    acc.feed('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n');
    expect(acc.usage()).toBeNull();
  });

  test("malformed frames are skipped without throwing", () => {
    const acc = createSseUsageAccumulator("openai");
    acc.feed("data: {not json}\n");
    acc.feed('data: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n');
    expect(acc.usage()).toEqual({ inputTokens: 5, outputTokens: 2 });
  });
});
