import { describe, expect, test } from "bun:test";
import type { RequestOutcome } from "./evidence";
import { createHealthState } from "./health";

function outcome(requestId: string): RequestOutcome {
  return {
    kind: "completed",
    requestId,
    occurredAt: "2026-07-10T12:00:00.000Z",
    keyId: "vk_demo",
    provider: "anthropic",
    endpoint: "messages",
    model: "claude-sonnet-5",
    stream: false,
    status: 200,
    latencyMs: 10,
    policyDecision: "allow",
  };
}

describe("createHealthState — block mode", () => {
  test("failure flips unhealthy; successful retry drain restores health", async () => {
    const health = createHealthState({ mode: () => "block" });
    expect(health.ok()).toBe(true);

    health.reportEvidenceFailure(outcome("req_1"));
    health.reportEvidenceFailure(outcome("req_2"));
    expect(health.ok()).toBe(false);
    expect(health.pendingCount()).toBe(2);

    const recorded: string[] = [];
    await health.retryPending(async (o) => {
      recorded.push(o.requestId);
    });
    expect(recorded).toEqual(["req_1", "req_2"]);
    expect(health.pendingCount()).toBe(0);
    expect(health.ok()).toBe(true);
  });

  test("a still-failing retry keeps the queue and stays unhealthy", async () => {
    const health = createHealthState({ mode: () => "block" });
    health.reportEvidenceFailure(outcome("req_1"));
    await health.retryPending(() => Promise.reject(new Error("still down")));
    expect(health.pendingCount()).toBe(1);
    expect(health.ok()).toBe(false);
  });

  test("a success report alone does not clear a non-empty queue", () => {
    const health = createHealthState({ mode: () => "block" });
    health.reportEvidenceFailure(outcome("req_1"));
    health.reportEvidenceSuccess();
    expect(health.ok()).toBe(false);
  });
});

describe("createHealthState — degrade mode and overflow", () => {
  test("degrade mode always reports healthy while still queueing", () => {
    const health = createHealthState({ mode: () => "degrade" });
    health.reportEvidenceFailure(outcome("req_1"));
    expect(health.ok()).toBe(true);
    expect(health.pendingCount()).toBe(1);
  });

  test("bounded queue drops oldest; droppedCount is non-destructive until consumed", () => {
    const health = createHealthState({ mode: () => "degrade", maxPending: 2 });
    health.reportEvidenceFailure(outcome("req_1"));
    health.reportEvidenceFailure(outcome("req_2"));
    health.reportEvidenceFailure(outcome("req_3"));
    expect(health.pendingCount()).toBe(2);
    expect(health.droppedCount()).toBe(1);
    expect(health.droppedCount()).toBe(1); // reading must not zero it
    health.consumeDropped(1);
    expect(health.droppedCount()).toBe(0);
  });

  test("drops survive a failing retry tick (regression: destructive read lost them)", async () => {
    const health = createHealthState({ mode: () => "degrade", maxPending: 1 });
    health.reportEvidenceFailure(outcome("req_1"));
    health.reportEvidenceFailure(outcome("req_2")); // overflows, drops req_1
    expect(health.droppedCount()).toBe(1);
    await health.retryPending(() => Promise.reject(new Error("sink still down")));
    expect(health.droppedCount()).toBe(1); // still reportable after the failed tick
    expect(health.pendingCount()).toBe(1);
  });

  test("mode getter applies reloaded mode to an existing state", () => {
    let mode: "block" | "degrade" = "block";
    const health = createHealthState({ mode: () => mode });
    health.reportEvidenceFailure(outcome("req_1"));
    expect(health.ok()).toBe(false);
    mode = "degrade";
    expect(health.ok()).toBe(true); // mode change applies without recreating state
    expect(health.pendingCount()).toBe(1); // pending evidence survives
  });
});
