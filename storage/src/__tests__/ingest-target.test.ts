import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createFileOutboxAdapter, type OutboxPayload } from "../outbox";
import {
  createHttpIngestTarget,
  createHttpOutboxDispatcher,
  IngestClientError,
  IngestConflictError,
  IngestRetryableError,
} from "../ingest-target";

const BASE_URL = "https://console.example.test";
const KEY = "vrt_test_secret_value";

/**
 * Builds a fetch double that returns the queued responses in order (repeating
 * the last) and records every call so tests can assert URL, headers, and body.
 */
function fetchReturning(...responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const spec = responses[Math.min(index, responses.length - 1)] ?? { status: 200, body: {} };
    index += 1;
    return new Response(spec.body === undefined ? null : JSON.stringify(spec.body), {
      status: spec.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function payloadOf(records: number, edges: number): OutboxPayload {
  return {
    schemaVersion: "2026-06-23",
    mutationBinding: "same_transaction",
    records: Array.from({ length: records }, (_, i) => ({
      id: `evt_${i}`,
      actor: { type: "user", id: "usr_1" },
      action: "change.declared",
      target: { type: "change", id: `chg_${i}` },
      scope: { tenantId: "proj_1" },
      metadata: {},
    })),
    edges: Array.from({ length: edges }, (_, i) => ({
      id: `edge_${i}`,
      from: { type: "change", id: "chg_0" },
      relation: "has_output",
      to: { type: "revision", id: `rev_${i}` },
      scope: { tenantId: "proj_1" },
    })),
  };
}

describe("http ingest target", () => {
  test("dispatchEntry posts one batched request with the bearer key and parses the result", async () => {
    const { impl, calls } = fetchReturning({
      status: 200,
      body: { appended: { events: 3, edges: 4 }, tips: { event: "sha256:e", edge: "sha256:x" } },
    });
    const target = createHttpIngestTarget({ baseUrl: BASE_URL, key: KEY, fetchImpl: impl });

    const result = await target.dispatchEntry(payloadOf(3, 4));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE_URL}/api/ingest`);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.events).toHaveLength(3);
    expect(body.edges).toHaveLength(4);
    expect(result).toEqual({ appended: { events: 3, edges: 4 }, tips: { event: "sha256:e", edge: "sha256:x" } });
  });

  test("an empty payload makes no network call", async () => {
    const { impl, calls } = fetchReturning({ status: 200, body: {} });
    const target = createHttpIngestTarget({ baseUrl: BASE_URL, key: KEY, fetchImpl: impl });
    const result = await target.dispatchEntry(payloadOf(0, 0));
    expect(calls).toHaveLength(0);
    expect(result.appended).toEqual({ events: 0, edges: 0 });
  });

  test("the record cap is the server's: an oversized batch surfaces as the 413 client error", async () => {
    const { impl, calls } = fetchReturning({
      status: 413,
      body: { error: "too many records in one request (max 1000)" },
    });
    const target = createHttpIngestTarget({ baseUrl: BASE_URL, key: KEY, fetchImpl: impl });
    const error = await target.dispatchEntry(payloadOf(1001, 0)).catch((e) => e);
    expect(error).toBeInstanceOf(IngestClientError);
    expect((error as IngestClientError).status).toBe(413);
    expect((error as IngestClientError).retryable).toBe(false);
    // The client no longer pre-caps; the server is the single authority.
    expect(calls).toHaveLength(1);
  });

  test("a 409 maps to a non-retryable conflict carrying partial appended counts", async () => {
    const { impl } = fetchReturning({
      status: 409,
      body: { error: "append conflict", appended: { events: 1, edges: 0 }, retryable: false },
    });
    const target = createHttpIngestTarget({ baseUrl: BASE_URL, key: KEY, fetchImpl: impl });
    try {
      await target.dispatchEntry(payloadOf(2, 1));
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestConflictError);
      expect((error as IngestConflictError).retryable).toBe(false);
      expect((error as IngestConflictError).appended).toEqual({ events: 1, edges: 0 });
    }
  });

  test("a 5xx maps to a retryable error", async () => {
    const { impl } = fetchReturning({ status: 503, body: { error: "append failed", retryable: true } });
    const target = createHttpIngestTarget({ baseUrl: BASE_URL, key: KEY, fetchImpl: impl });
    const error = await target.dispatchEntry(payloadOf(1, 0)).catch((e) => e);
    expect(error).toBeInstanceOf(IngestRetryableError);
    expect((error as IngestRetryableError).retryable).toBe(true);
  });

  test("a 4xx maps to a non-retryable client error and never leaks the key", async () => {
    const { impl } = fetchReturning({ status: 403, body: { error: "record tenant scope does not match credentials" } });
    const target = createHttpIngestTarget({ baseUrl: BASE_URL, key: KEY, fetchImpl: impl });
    const error = await target.dispatchEntry(payloadOf(1, 0)).catch((e) => e);
    expect(error).toBeInstanceOf(IngestClientError);
    expect((error as IngestClientError).status).toBe(403);
    expect(String((error as Error).message)).not.toContain(KEY);
  });
});

describe("http outbox dispatcher", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "veritio-ingest-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("retries a 5xx then succeeds, dispatching each entry as one POST", async () => {
    const adapter = createFileOutboxAdapter(join(dir, "outbox"));
    await adapter.transaction(async (tx) => {
      await tx.enqueue({ id: "entry_1", tenantId: "proj_1", payload: payloadOf(3, 4) });
    });

    const failing = fetchReturning({ status: 503, body: { retryable: true } });
    const firstPass = createHttpOutboxDispatcher({
      adapter,
      target: createHttpIngestTarget({ baseUrl: BASE_URL, key: KEY, fetchImpl: failing.impl }),
    });
    expect(await firstPass.dispatchBatch()).toEqual({ dispatched: 0, failed: 1 });
    expect((await adapter.list({ tenantId: "proj_1" }))[0]).toMatchObject({ status: "pending", attempts: 1 });

    const ok = fetchReturning({
      status: 200,
      body: { appended: { events: 3, edges: 4 }, tips: { event: "sha256:e", edge: "sha256:x" } },
    });
    const retry = createHttpOutboxDispatcher({
      adapter,
      target: createHttpIngestTarget({ baseUrl: BASE_URL, key: KEY, fetchImpl: ok.impl }),
    });
    expect(await retry.dispatchBatch()).toEqual({ dispatched: 1, failed: 0 });
    expect(ok.calls).toHaveLength(1); // one POST for the whole entry, not one per record
    expect((await adapter.list({ tenantId: "proj_1" }))[0]).toMatchObject({ status: "dispatched" });

    // A second dispatch is a no-op: the entry is already dispatched.
    expect(await retry.dispatchBatch()).toEqual({ dispatched: 0, failed: 0 });
  });
});
