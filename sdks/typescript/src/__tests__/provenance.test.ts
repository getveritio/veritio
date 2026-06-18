import { describe, expect, test } from "bun:test";
import {
  HASH_ALGORITHM,
  MemoryAuditStore,
  createAuditEvent,
  createEvidenceEdge,
  createProvenanceRecorder,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  verifyAuditRecords,
  verifyEvidenceEdgeRecords,
} from "../index";
import type { AuditEventInput, AuditRecord, EvidenceEdgeInput, EvidenceEdgeRecord, ProvenanceRecorder } from "../index";

const SCOPE = { tenantId: "tenant_demo", workspaceId: "ws_app", environment: "dev" };

// Minimal in-test sinks built ONLY from exported SDK primitives (no protocol
// logic reimplemented): events go through the real MemoryAuditStore; edges use a
// tiny tenant-chained recorder mirroring MemoryAuditStore for the edge chain.
function makeSinks() {
  const store = new MemoryAuditStore();
  const edgeRecords: EvidenceEdgeRecord[] = [];
  const edgeTips = new Map<string, EvidenceEdgeRecord>();
  return {
    store,
    edgeRecords,
    async recordEvent(input: AuditEventInput): Promise<AuditRecord> {
      return store.append(createAuditEvent(input));
    },
    async recordEdge(input: EvidenceEdgeInput): Promise<EvidenceEdgeRecord> {
      const edge = createEvidenceEdge(input);
      const tenantId = edge.scope?.tenantId as string;
      const tip = edgeTips.get(tenantId);
      const recordWithoutHash: Omit<EvidenceEdgeRecord, "hash"> = {
        edge,
        sequence: (tip?.sequence ?? 0) + 1,
        previousHash: tip?.hash ?? null,
        hashAlgorithm: HASH_ALGORITHM,
        canonicalization: "veritio-json-v1",
        appendedAt: new Date().toISOString(),
        idempotencyKeyHash: hashIdempotencyKey(tenantId, edge.id),
      };
      const record: EvidenceEdgeRecord = { ...recordWithoutHash, hash: hashEvidenceEdgeRecord(recordWithoutHash) };
      edgeRecords.push(record);
      edgeTips.set(tenantId, record);
      return record;
    },
  };
}

function startBasicSession(recorder: ProvenanceRecorder) {
  return recorder.startSession({
    scope: SCOPE,
    sessionId: "agt_sess_01",
    initiatedBy: { type: "user", id: "usr_builder" },
    agentActor: { type: "ai_agent", id: "agent_opencode" },
    agent: { name: "opencode", version: "1.17" },
    model: { provider: "anthropic", name: "claude-opus-4-8" },
  });
}

describe("createProvenanceRecorder.startSession", () => {
  test("emits agent.session.started with canonical agent/model metadata and a caused_by edge to the human", async () => {
    const sinks = makeSinks();
    const recorder = createProvenanceRecorder(sinks);

    const { session, result } = await recorder.startSession({
      scope: SCOPE,
      sessionId: "agt_sess_01",
      initiatedBy: { type: "user", id: "usr_builder" },
      agentActor: { type: "ai_agent", id: "agent_opencode" },
      agent: { name: "opencode", version: "1.17" },
      model: { provider: "anthropic", name: "claude-opus-4-8" },
      promptHash: "sha256:prompt",
    });

    expect(session.sessionId).toBe("agt_sess_01");
    expect(result.event.event.action).toBe("agent.session.started");
    expect(result.event.event.actor).toEqual({ type: "ai_agent", id: "agent_opencode" });
    expect(result.event.event.target).toEqual({ type: "agent_session", id: "agt_sess_01" });
    expect(result.event.event.metadata.agent).toEqual({ name: "opencode", version: "1.17" });
    expect(result.event.event.metadata.model).toEqual({ provider: "anthropic", name: "claude-opus-4-8" });
    expect(result.event.event.metadata.sessionId).toBe("agt_sess_01");

    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0]!.edge;
    expect(edge.from).toEqual({ type: "agent_session", id: "agt_sess_01" });
    expect(edge.relation).toBe("caused_by");
    expect(edge.to).toEqual({ type: "actor", id: "usr_builder", actorType: "user" });
  });

  test("emits an optional caused_by edge to the originating request when requestId is supplied", async () => {
    const sinks = makeSinks();
    const recorder = createProvenanceRecorder(sinks);
    const { result } = await recorder.startSession({
      scope: SCOPE,
      sessionId: "agt_sess_02",
      initiatedBy: { type: "user", id: "usr_builder" },
      agentActor: { type: "ai_agent", id: "agent_opencode" },
      agent: { name: "opencode", version: "1.17" },
      model: { provider: "anthropic", name: "claude-opus-4-8" },
      requestId: "req_track_toasts",
    });
    expect(result.edges).toHaveLength(2);
    expect(result.edges[1]!.edge.to).toEqual({
      type: "resource",
      id: "req_track_toasts",
      resourceType: "change_request",
    });
  });
});

describe("provenance session change recording", () => {
  test("tool call emits agent.tool.called + session-created + modified/read edges", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const { event, edges } = await session.recordToolCall({
      toolCallId: "tool_01",
      tool: "apply_edits",
      status: "succeeded",
      approval: "auto_allowed",
      modifies: [{ id: "file_shared", pathHash: "sha256:p1", afterHash: "sha256:a1", beforeHash: "sha256:b1" }],
      reads: [{ id: "file_readme", pathHash: "sha256:p2" }],
    });
    expect(event.event.action).toBe("agent.tool.called");
    expect(event.event.target).toEqual({ type: "tool_call", id: "tool_01" });
    // Every session-emitted event carries metadata.sessionId for group-by reads.
    expect(event.event.metadata.sessionId).toBe("agt_sess_01");
    const rels = edges.map((e) => `${e.edge.from.type}:${e.edge.relation}:${e.edge.to.type}`);
    expect(rels).toContain("agent_session:created:tool_call");
    expect(rels).toContain("tool_call:modified:file");
    expect(rels).toContain("tool_call:read:file");
  });

  test("file change emits change.files.changed + modified + hunk part_of edges", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const { event, edges } = await session.recordFileChange({
      sourceTreeId: "tree_01",
      resultVersion: 42,
      changedBy: { type: "tool_call", id: "tool_01" },
      files: [{ id: "file_shared", pathHash: "sha256:p1", afterHash: "sha256:a1", hunkHashes: ["sha256:h1"] }],
    });
    expect(event.event.action).toBe("change.files.changed");
    const rels = edges.map((e) => `${e.edge.from.type}:${e.edge.relation}:${e.edge.to.type}`);
    expect(rels).toContain("tool_call:modified:file");
    expect(rels).toContain("diff_hunk:part_of:file");
  });
});

describe("provenance downstream recording", () => {
  test("review approval edge targets the reviewer human", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const { event, edges } = await session.recordReview({
      pullRequestId: "pr_01",
      reviewer: { type: "user", id: "usr_reviewer" },
      proposalId: "proposal_01",
      approvalHash: "sha256:approval",
    });
    expect(event.event.action).toBe("review.approval.recorded");
    expect(event.event.actor).toEqual({ type: "user", id: "usr_reviewer" });
    const rel = edges.map((e) => `${e.edge.relation}:${e.edge.to.id}`);
    expect(rel).toContain("approved_by:usr_reviewer");
  });

  test("a changes-requested review records a finding + reviewed_by, never approved_by", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const { event, edges } = await session.recordReview({
      pullRequestId: "pr_cr",
      reviewer: { type: "user", id: "usr_reviewer" },
      proposalId: "proposal_cr",
      decision: "changes_requested",
      findingCount: 2,
    });
    expect(event.event.action).toBe("review.finding.created");
    const rels = edges.map((e) => e.edge.relation);
    expect(rels).toContain("reviewed_by");
    expect(rels).not.toContain("approved_by");
  });

  test("ci + deploy + runtime emit built_by/deployed_as/observed_in", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const ci = await session.recordCiRun({
      ciRunId: "ci_01",
      service: { type: "service", id: "svc_ci" },
      status: "succeeded",
      artifactId: "artifact_01",
      checks: ["typecheck", "unit"],
      derivedFromFiles: [{ id: "file_shared", pathHash: "sha256:p1" }],
    });
    expect(ci.event.event.action).toBe("ci.job.completed");
    expect(ci.edges.map((e) => e.edge.relation)).toContain("built_by");

    const dep = await session.recordDeployment({
      deploymentId: "dep_01",
      service: { type: "service", id: "svc_deploy" },
      artifactId: "artifact_01",
      bundleHash: "sha256:bundle",
      policyId: "policy_prod",
      policyRequirements: ["human_approval"],
    });
    expect(dep.edges.map((e) => e.edge.relation)).toContain("deployed_as");
    expect(dep.edges.map((e) => e.edge.relation)).toContain("satisfies_policy");

    const rt = await session.recordRuntimeEvent({
      runtimeEventId: "rt_01",
      actor: { type: "user", id: "usr_reviewer" },
      action: "audit.runtime.observed",
      deploymentId: "dep_01",
      routeHash: "sha256:route",
    });
    expect(rt.event.event.action).toBe("audit.runtime.observed");
    expect(rt.edges.map((e) => e.edge.relation)).toContain("observed_in");
  });

  test("link emits an arbitrary edge for cross-session / feedback connectors", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const edge = await session.link(
      { type: "file", id: "file_shared", pathHash: "sha256:p1" },
      "modified",
      { type: "file", id: "file_shared_b", pathHash: "sha256:p1" },
      { note: "same file across sessions" },
    );
    expect(edge.edge.relation).toBe("modified");
  });
});

describe("provenance privacy + semantics", () => {
  test("sensitive-keyed metadata passed to a recorder method is deterministically redacted", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const first = await session.recordToolCall({
      toolCallId: "tool_secret",
      tool: "fetch",
      status: "succeeded",
      metadata: { authorization: "Bearer abc123", email: "a@b.c", note: "ok" },
    });
    expect(first.event.event.metadata.authorization).toBe("[redacted]");
    expect(first.event.event.metadata.email).toBe("[redacted]");
    expect(first.event.event.metadata.note).toBe("ok");

    // Determinism: same input → identical event id and identical redacted metadata.
    const second = await createProvenanceRecorder(makeSinks());
    const { session: s2 } = await startBasicSession(second);
    const again = await s2.recordToolCall({
      toolCallId: "tool_secret",
      tool: "fetch",
      status: "succeeded",
      metadata: { authorization: "Bearer abc123", email: "a@b.c", note: "ok" },
    });
    expect(again.event.event.id).toBe(first.event.event.id);
    expect(again.event.event.metadata).toEqual(first.event.event.metadata);
  });

  test("metadata.sessionId is stamped on every event and cannot be shadowed by caller metadata", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const prompt = await session.recordPrompt({ promptHash: "sha256:prompt" });
    expect(prompt.event.event.metadata.sessionId).toBe("agt_sess_01");
    // A caller trying to spoof a different session id is overridden.
    const tool = await session.recordToolCall({
      toolCallId: "tool_spoof",
      tool: "fetch",
      status: "succeeded",
      metadata: { sessionId: "agt_sess_OTHER" },
    });
    expect(tool.event.event.metadata.sessionId).toBe("agt_sess_01");
  });

  test("file deletions are recorded with the deleted relation, not modified", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const { edges } = await session.recordFileChange({
      sourceTreeId: "tree_del",
      resultVersion: 7,
      files: [{ id: "file_gone", pathHash: "sha256:pg", afterHash: "sha256:none", action: "delete" }],
    });
    const rels = edges.map((e) => `${e.edge.relation}:${e.edge.to.type}`);
    expect(rels).toContain("deleted:file");
    expect(rels).not.toContain("modified:file");
  });

  test("a waived review emits review.waiver.recorded + a waived_by edge", async () => {
    const recorder = createProvenanceRecorder(makeSinks());
    const { session } = await startBasicSession(recorder);
    const { event, edges } = await session.recordReview({
      pullRequestId: "pr_waive",
      reviewer: { type: "user", id: "usr_reviewer" },
      proposalId: "proposal_waive",
      decision: "waived",
      waiverCount: 1,
    });
    expect(event.event.action).toBe("review.waiver.recorded");
    expect(edges.map((e) => e.edge.relation)).toContain("waived_by");
    expect(edges.map((e) => e.edge.relation)).not.toContain("approved_by");
  });

  test("deterministic ids let an idempotency-keyed store replay startSession once", async () => {
    const sinks = makeSinks();
    const recorder = createProvenanceRecorder(sinks);
    const a = await startBasicSession(recorder);
    const b = await startBasicSession(recorder);
    // Same logical session → same event id; MemoryAuditStore replays idempotently.
    expect(b.result.event.event.id).toBe(a.result.event.event.id);
    const sessionEvents = sinks.store.records().filter((r) => r.event.action === "agent.session.started");
    expect(sessionEvents).toHaveLength(1);
    // Edges are also deterministic across the two runs.
    expect(b.result.edges[0]!.edge.id).toBe(a.result.edges[0]!.edge.id);
  });
});

describe("provenance end-to-end day", () => {
  test("multi-step session: chains verify and the enforcing human is reachable one hop from the change", async () => {
    const sinks = makeSinks();
    const recorder = createProvenanceRecorder(sinks);
    const { session } = await startBasicSession(recorder);
    await session.recordPrompt({ promptHash: "sha256:prompt" });
    await session.recordToolCall({
      toolCallId: "tool_01",
      tool: "apply_edits",
      status: "succeeded",
      modifies: [{ id: "file_shared", pathHash: "sha256:p1", afterHash: "sha256:a1" }],
    });
    await session.recordChangeProposal({
      proposalId: "proposal_01",
      resultVersion: 42,
      createdHunks: [{ id: "hunk_01", hash: "sha256:h1", fileId: "file_shared", pathHash: "sha256:p1" }],
    });
    await session.recordFileChange({
      sourceTreeId: "tree_01",
      resultVersion: 42,
      changedBy: { type: "tool_call", id: "tool_01" },
      causedByProposalId: "proposal_01",
      files: [{ id: "file_shared", pathHash: "sha256:p1", afterHash: "sha256:a1", hunkHashes: ["sha256:h1"] }],
    });

    // Audit chain verifies.
    expect(verifyAuditRecords(sinks.store.records())).toEqual({ ok: true });
    // Edge chain verifies.
    expect(verifyEvidenceEdgeRecords(sinks.edgeRecords)).toEqual({ ok: true });

    // Connectivity: session --caused_by--> human exists exactly once.
    const causedByHuman = sinks.edgeRecords.filter(
      (r) => r.edge.from.type === "agent_session" && r.edge.relation === "caused_by" && r.edge.to.id === "usr_builder",
    );
    expect(causedByHuman).toHaveLength(1);
  });
});
