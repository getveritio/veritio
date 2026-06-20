import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createProvenanceRecorder } from "@veritio/core";
import { createFileEvidenceStore } from "@veritio/storage";

import { exportSession, getSession, listSessions } from "../query";

const SCOPE = { tenantId: "local" };

/** Seeds a deployed session and a changes-requested session into a file store. */
async function seed(dir: string) {
  const store = createFileEvidenceStore(dir);
  const recorder = createProvenanceRecorder(store);

  const a = await recorder.startSession({
    scope: SCOPE,
    sessionId: "sess_toasts",
    initiatedBy: { type: "user", id: "usr_alice" },
    agentActor: { type: "ai_agent", id: "agent_cc" },
    agent: { name: "claude-code" },
    model: { provider: "anthropic", name: "claude-opus-4-8" },
    occurredAt: "2026-06-18T09:00:00.000Z",
    branch: "feat/toasts",
  });
  await a.session.recordToolCall({
    occurredAt: "2026-06-18T09:01:00.000Z",
    toolCallId: "tc_a_0",
    tool: "Edit",
    status: "succeeded",
  });
  await a.session.recordFileChange({
    occurredAt: "2026-06-18T09:02:00.000Z",
    sourceTreeId: "tree",
    changedBy: { type: "tool_call", id: "tc_a_0" },
    files: [{ id: "f1", pathHash: "sha256:p1", afterHash: "sha256:a1", action: "upsert" }],
  });
  await a.session.recordDeployment({
    occurredAt: "2026-06-18T09:03:00.000Z",
    deploymentId: "dep_a",
    service: { type: "service", id: "svc" },
    artifactId: "art_a",
  });

  const b = await recorder.startSession({
    scope: SCOPE,
    sessionId: "sess_kpi",
    initiatedBy: { type: "user", id: "usr_diego" },
    agentActor: { type: "ai_agent", id: "agent_cc" },
    agent: { name: "claude-code" },
    model: { provider: "anthropic", name: "claude-opus-4-8" },
    occurredAt: "2026-06-18T11:00:00.000Z",
    branch: "feat/kpi",
  });
  await b.session.recordReview({
    occurredAt: "2026-06-18T11:05:00.000Z",
    pullRequestId: "pr_b",
    reviewer: { type: "user", id: "usr_alice" },
    proposalId: "prop_b",
    decision: "changes_requested",
  });

  return store;
}

describe("query", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "veritio-cc-query-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("listSessions summarizes each session", async () => {
    const store = await seed(dir);
    const sessions = await listSessions(store);
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(["sess_kpi", "sess_toasts"]);

    const toasts = sessions.find((s) => s.sessionId === "sess_toasts")!;
    expect(toasts.outcome).toBe("deployed");
    expect(toasts.branch).toBe("feat/toasts");
    expect(toasts.humanId).toBe("usr_alice");
    expect(toasts.changeCount).toBe(1);
    expect(toasts.agent).toEqual({ name: "claude-code" });

    const kpi = sessions.find((s) => s.sessionId === "sess_kpi")!;
    expect(kpi.outcome).toBe("changes_requested");
    expect(kpi.humanId).toBe("usr_diego");
  });

  test("getSession returns only that session's events + a graph", async () => {
    const store = await seed(dir);
    const { events, graph } = await getSession(store, "sess_toasts");
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((r) => r.event.metadata.sessionId === "sess_toasts")).toBe(true);
    // The session's caused_by→human edge is in scope.
    expect(graph.edges.some((e) => e.relation === "caused_by" && e.to.id === "usr_alice")).toBe(true);
  });

  test("exportSession yields a verifiable bundle", async () => {
    const store = await seed(dir);
    const bundle = await exportSession(store, "sess_toasts");
    expect(bundle.verification.ok).toBe(true);
    expect(bundle.events.length).toBeGreaterThan(0);
    expect(bundle.edges.length).toBeGreaterThan(0);
  });
});
