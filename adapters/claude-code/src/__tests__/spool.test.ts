import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEvent } from "@veritio/core";

import { IngestHttpError, isRetryableIngestFailure } from "../ingest";
import { flushSpool, listSpool, MAX_SPOOL_BATCHES, saveToSpool, shipWithSpool } from "../spool";

/**
 * Regression suite for the offline capture spool (July 2026 incident: the
 * hosted tenant DB was quota-blocked for weeks and every capture batch was
 * silently dropped). Pins the retryable/permanent split, the bounded queue,
 * order-preserving drain, and that the hook-facing entrypoint never lets the
 * spool's own failures surface as hook failures.
 */

const EVENT = (id: string) =>
  ({
    id,
    schemaVersion: "1.0",
    occurredAt: "2026-07-18T00:00:00.000Z",
    actor: { id: "yan", type: "user" },
    action: "debug.spool.test",
    target: { id: "t1", type: "diagnostic" },
    metadata: {},
  }) as unknown as AuditEvent;

function payloadOf(id: string) {
  return { events: [EVENT(id)], edges: [] };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "veritio-spool-"));
  dirs.push(dir);
  return dir;
}

const received: string[] = [];
let mode: "ok" | "quota-blocked" | "forbidden" = "ok";
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (mode === "quota-blocked") {
      return new Response(JSON.stringify({ error: "tenant database temporarily unavailable", retryable: true }), {
        status: 503,
      });
    }
    if (mode === "forbidden") {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }
    const body = (await request.json()) as { events: { id: string }[] };
    received.push(...body.events.map((event) => event.id));
    return new Response(JSON.stringify({ appended: { events: body.events.length, edges: 0 } }), { status: 200 });
  },
});
const INGEST = { url: server.url.href, key: "vrt_test", timeoutMs: 2_000 };

afterEach(() => {
  mode = "ok";
  received.length = 0;
});

afterAll(() => {
  server.stop(true);
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("isRetryableIngestFailure", () => {
  test("5xx and 429 retry; other 4xx are permanent; transport errors retry", () => {
    expect(isRetryableIngestFailure(new IngestHttpError(503))).toBe(true);
    expect(isRetryableIngestFailure(new IngestHttpError(500))).toBe(true);
    expect(isRetryableIngestFailure(new IngestHttpError(429))).toBe(true);
    expect(isRetryableIngestFailure(new IngestHttpError(403))).toBe(false);
    expect(isRetryableIngestFailure(new IngestHttpError(402))).toBe(false);
    expect(isRetryableIngestFailure(new IngestHttpError(422))).toBe(false);
    expect(isRetryableIngestFailure(new Error("fetch failed"))).toBe(true);
  });
});

describe("shipWithSpool", () => {
  test("healthy endpoint: ships directly, nothing spooled", async () => {
    const dir = tempDir();
    await shipWithSpool(INGEST, dir, payloadOf("evt_direct"));
    expect(received).toEqual(["evt_direct"]);
    expect(listSpool(dir)).toEqual([]);
  });

  test("retryable outage spools the batch instead of dropping it", async () => {
    const dir = tempDir();
    mode = "quota-blocked";
    await shipWithSpool(INGEST, dir, payloadOf("evt_outage"));
    expect(listSpool(dir)).toHaveLength(1);
  });

  test("transport outage (unreachable endpoint) also spools", async () => {
    const dir = tempDir();
    await shipWithSpool(
      { url: "http://127.0.0.1:9/ingest", key: "vrt_test", timeoutMs: 500 },
      dir,
      payloadOf("evt_unreachable"),
    );
    expect(listSpool(dir)).toHaveLength(1);
  });

  test("permanent rejection does not spool and surfaces like before", async () => {
    const dir = tempDir();
    mode = "forbidden";
    await expect(shipWithSpool(INGEST, dir, payloadOf("evt_denied"))).rejects.toThrow(
      "ingest POST failed with status 403",
    );
    expect(listSpool(dir)).toEqual([]);
  });

  test("backlog drains oldest-first with the new batch queued behind it", async () => {
    const dir = tempDir();
    mode = "quota-blocked";
    await shipWithSpool(INGEST, dir, payloadOf("evt_1"));
    await shipWithSpool(INGEST, dir, payloadOf("evt_2"));
    expect(listSpool(dir)).toHaveLength(2);

    mode = "ok";
    await shipWithSpool(INGEST, dir, payloadOf("evt_3"));
    expect(received).toEqual(["evt_1", "evt_2", "evt_3"]);
    expect(listSpool(dir)).toEqual([]);
  });
});

describe("flushSpool", () => {
  test("stops at the first retryable failure and keeps the queue", async () => {
    const dir = tempDir();
    saveToSpool(dir, payloadOf("evt_kept"));
    mode = "quota-blocked";
    await flushSpool(INGEST, dir);
    expect(listSpool(dir)).toHaveLength(1);
  });

  test("deletes a permanently rejected batch and continues", async () => {
    const dir = tempDir();
    saveToSpool(dir, payloadOf("evt_poison"));
    mode = "forbidden";
    await flushSpool(INGEST, dir);
    expect(listSpool(dir)).toEqual([]);
  });

  test("drops an unreadable spool entry instead of wedging the queue", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "spool"), { recursive: true });
    writeFileSync(join(dir, "spool", "000000000000001-1.json"), "not json", "utf8");
    saveToSpool(dir, payloadOf("evt_after_corrupt"));
    await flushSpool(INGEST, dir);
    expect(received).toEqual(["evt_after_corrupt"]);
    expect(listSpool(dir)).toEqual([]);
  });

  test("respects the per-invocation batch cap", async () => {
    const dir = tempDir();
    for (let i = 0; i < 5; i += 1) {
      saveToSpool(dir, payloadOf(`evt_${i}`));
    }
    await flushSpool(INGEST, dir, 2);
    expect(received).toEqual(["evt_0", "evt_1"]);
    expect(listSpool(dir)).toHaveLength(3);
  });
});

describe("saveToSpool bounds", () => {
  test("evicts oldest past MAX_SPOOL_BATCHES", () => {
    const dir = tempDir();
    // Pre-seed the cap with cheap direct writes (sorted names), then one more
    // save must evict exactly the oldest.
    mkdirSync(join(dir, "spool"), { recursive: true });
    for (let i = 0; i < MAX_SPOOL_BATCHES; i += 1) {
      writeFileSync(
        join(dir, "spool", `${String(i).padStart(15, "0")}-seed.json`),
        JSON.stringify(payloadOf(`evt_seed_${i}`)),
        "utf8",
      );
    }
    saveToSpool(dir, payloadOf("evt_newest"));
    const names = readdirSync(join(dir, "spool")).sort();
    expect(names).toHaveLength(MAX_SPOOL_BATCHES);
    expect(names[0]).toBe(`${String(1).padStart(15, "0")}-seed.json`);
  });
});
