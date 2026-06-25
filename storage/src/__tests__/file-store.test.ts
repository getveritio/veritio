import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createFileEvidenceStore } from "../file-store";

const TENANT = "tenant_local";

function eventInput(id: string, overrides: { action?: string; tenantId?: string } = {}) {
  return {
    id,
    occurredAt: "2026-06-18T09:00:00.000Z",
    actor: { type: "ai_agent", id: "agent_claude_code" },
    action: overrides.action ?? "agent.session.started",
    target: { type: "agent_session", id: "sess_1" },
    scope: { tenantId: overrides.tenantId ?? TENANT },
    metadata: { sessionId: "sess_1" },
  };
}

function edgeInput(id: string) {
  return {
    id,
    occurredAt: "2026-06-18T09:00:00.000Z",
    scope: { tenantId: TENANT },
    from: { type: "agent_session", id: "sess_1" },
    relation: "caused_by" as const,
    to: { type: "actor", id: "usr_alice", actorType: "user" as const },
    metadata: { role: "enforced_by" },
  };
}

describe("createFileEvidenceStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "veritio-fs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("appends hash-chained events + edges that verify, and survives reopen", async () => {
    const store = createFileEvidenceStore(dir);
    const a = await store.recordEvent(eventInput("evt_1"));
    const b = await store.recordEvent(eventInput("evt_2", { action: "agent.tool.called" }));
    await store.recordEdge(edgeInput("edge_1"));
    expect(a.sequence).toBe(1);
    expect(a.previousHash).toBeNull();
    expect(b.sequence).toBe(2);
    expect(b.previousHash).toBe(a.hash);

    // A fresh store on the same dir (mirrors a new hook process) sees the chain.
    const reopened = createFileEvidenceStore(dir);
    expect(await reopened.listEvents()).toHaveLength(2);
    expect(await reopened.listEdges()).toHaveLength(1);
    const report = await reopened.verify();
    expect(report.ok).toBe(true);
  });

  test("batch appends events, edges, and an EvidenceCommit manifest", async () => {
    const store = createFileEvidenceStore(dir);
    const batch = await store.recordBatch({
      commitId: "cmt_local_batch_01",
      streamId: "str_local_tenant",
      events: [eventInput("evt_batch_1")],
      edges: [edgeInput("edge_batch_1")],
      committedAt: "2026-06-23T10:15:31.000Z",
    });

    expect(batch.events).toHaveLength(1);
    expect(batch.edges).toHaveLength(1);
    expect(batch.commit.recordCount).toBe(2);
    expect(batch.commit.sequence).toBe(1);
    expect(batch.commit.previousCommitHash).toBeNull();
    expect(batch.commit.members.map((member) => member.recordType)).toEqual(["audit.record", "evidence.edge.record"]);

    const second = await store.recordBatch({
      commitId: "cmt_local_batch_02",
      streamId: "str_local_tenant",
      events: [eventInput("evt_batch_2")],
      edges: [],
      committedAt: "2026-06-23T10:16:31.000Z",
    });

    expect(second.commit.sequence).toBe(2);
    expect(second.commit.previousCommitHash).toBe(batch.commit.hash);

    const replay = await store.recordBatch({
      commitId: "cmt_local_batch_01",
      streamId: "str_local_tenant",
      events: [eventInput("evt_batch_1")],
      edges: [edgeInput("edge_batch_1")],
      committedAt: "2026-06-23T10:15:31.000Z",
    });
    expect(replay.commit).toEqual(batch.commit);

    expect((await store.verify()).commits).toEqual({ ok: true });
    expect(await store.listCommits()).toHaveLength(2);
  });

  test("replays idempotently and rejects a conflicting payload on the same id", async () => {
    const store = createFileEvidenceStore(dir);
    const first = await store.recordEvent(eventInput("evt_1"));
    const replay = await store.recordEvent(eventInput("evt_1"));
    expect(replay.hash).toBe(first.hash);
    expect(await store.listEvents()).toHaveLength(1);

    await expect(store.recordEvent(eventInput("evt_1", { action: "agent.tampered.action" }))).rejects.toThrow(
      "idempotency conflict",
    );
  });

  test("fails closed without tenant scope", async () => {
    const store = createFileEvidenceStore(dir);
    await expect(store.recordEvent(eventInput("evt_1", { tenantId: "" }))).rejects.toThrow(
      "scope.tenantId is required",
    );
  });
});
