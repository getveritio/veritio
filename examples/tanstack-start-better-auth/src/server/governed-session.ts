import { createHash, randomUUID } from "node:crypto";
import {
  HASH_ALGORITHM,
  MemoryAuditStore,
  createAuditEvent,
  createEvidenceEdge,
  createProvenanceRecorder,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  type AuditEventInput,
  type AuditRecord,
  type EvidenceEdgeInput,
  type EvidenceEdgeRecord,
  type ProvenanceSinks,
} from "@veritio/core";
import { cloudTenantId, dispatchBatchToCloud, type DispatchResult } from "./cloud-ingest";
import { listEntries, runGovernedAction } from "./governed-entries";

/**
 * The agent-session capability for the example. One UI action models a real
 * governed AI workflow end to end: a cost agent (enforced by a human pricing
 * lead) opens an `agent.session.started` session, records its prompt, reads the
 * estimate documents, proposes a recalculation and writes the change, then drives
 * the ACTUAL governed recalculations as entity revisions — every event stamped
 * with one `sessionId` so the Cloud groups them into a single session — and a
 * human review finally approves it.
 *
 * This is what lights up the hosted Agent Sessions, Activity Graph, Code Changes,
 * and Changes/Entities surfaces from a single click. The provenance recorder
 * (`createProvenanceRecorder`) writes to injected sinks; here the sink CAPTURES
 * the raw event/edge inputs (while still returning valid hash-chained records, so
 * the recorder contract holds) so they can be delivered to hosted ingest as one
 * batch. Prompts and document contents are hashed, never raw — the recorder
 * enforces this and the Cloud re-redacts again at ingest.
 */

const COST_AGENT_PRINCIPAL = { type: "ai_agent", id: "cost_agent_7" } as const;
const PRICING_LEAD = { type: "user", id: "usr_pricing_lead" } as const;
const SESSION_AGENT = { name: "veritio-cost-agent", version: "1.0.0" } as const;
const SESSION_MODEL = { provider: "anthropic", name: "claude-opus-4-8" } as const;
const SESSION_REPO = { provider: "github", id: "acme/portfolio-estimates" } as const;

/** sha256:-prefixed content hash, matching the recorder's hash conventions. */
function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface AgentSessionView {
  sessionId: string;
  occurredAt: string;
  agentLabel: string;
  modelLabel: string;
  recalculated: string[];
  outcome: "approved";
  dispatch: DispatchResult;
}

/** Reuses one session feed (newest first) across Vite dev reloads. */
function sessionFeed(): AgentSessionView[] {
  const ref = globalThis as typeof globalThis & { __veritioAgentSessions?: AgentSessionView[] };
  ref.__veritioAgentSessions ??= [];
  return ref.__veritioAgentSessions;
}

/** Lists the most recent agent sessions and their dispatch outcomes. */
export function listAgentSessions(limit = 10): AgentSessionView[] {
  return sessionFeed().slice(0, limit);
}

/**
 * A collecting provenance sink. It CAPTURES every recorder event/edge input for
 * batch delivery to the Cloud, while still returning valid hash-chained records
 * built from SDK primitives (mirroring the SDK's own test sink) so the recorder
 * contract holds — no protocol logic is reimplemented. `take()` drains and clears
 * the buffer so the caller can dispatch in phases under one session.
 */
function collectingSink(): {
  sinks: ProvenanceSinks;
  take(): { records: AuditEventInput[]; edges: EvidenceEdgeInput[] };
} {
  const events: AuditEventInput[] = [];
  const edges: EvidenceEdgeInput[] = [];
  const store = new MemoryAuditStore();
  const edgeTips = new Map<string, EvidenceEdgeRecord>();
  return {
    sinks: {
      async recordEvent(input: AuditEventInput): Promise<AuditRecord> {
        events.push(input);
        return store.append(createAuditEvent(input));
      },
      async recordEdge(input: EvidenceEdgeInput): Promise<EvidenceEdgeRecord> {
        edges.push(input);
        const edge = createEvidenceEdge(input);
        const tenantId = String(edge.scope?.tenantId ?? "");
        const tip = edgeTips.get(tenantId);
        const withoutHash: Omit<EvidenceEdgeRecord, "hash"> = {
          edge,
          sequence: (tip?.sequence ?? 0) + 1,
          previousHash: tip?.hash ?? null,
          hashAlgorithm: HASH_ALGORITHM,
          canonicalization: "veritio-json-v1",
          appendedAt: new Date().toISOString(),
          idempotencyKeyHash: hashIdempotencyKey(tenantId, edge.id),
        };
        const record: EvidenceEdgeRecord = { ...withoutHash, hash: hashEvidenceEdgeRecord(withoutHash) };
        edgeTips.set(tenantId, record);
        return record;
      },
    },
    take() {
      return { records: events.splice(0), edges: edges.splice(0) };
    },
  };
}

export interface AgentSessionResult {
  session: AgentSessionView;
}

/**
 * Runs one governed agent session end to end (see module docstring). Recalculates
 * every active entry under one session id: the recorder evidence is delivered as
 * direct batches, the governed recalcs flow through the transactional outbox, and
 * all of it shares one `sessionId` so the Cloud presents a single session.
 */
export async function runAgentSession(): Promise<AgentSessionResult> {
  const tenantId = cloudTenantId();
  const sessionId = `agt_sess_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const occurredAt = new Date().toISOString();
  const scope = { tenantId, environment: "reference" };

  // The active entries this session recalculates, modelled as estimate documents.
  const targets = listEntries().filter((entry) => entry.status === "active");
  const docFiles = targets.map((entry) => ({
    id: `estimate_doc_${entry.id}`,
    pathHash: sha256(`estimate/${entry.id}`),
    beforeHash: sha256(`estimate/${entry.id}/v${entry.version}`),
  }));
  const promptHash = sha256("Recalculate monthly estimates for all active towers from current quantities.");
  const proposalId = `prop_${sessionId}`;

  const sink = collectingSink();
  const recorder = createProvenanceRecorder(sink.sinks);

  // Phase 1 — open the session and record the agent's reasoning + proposed change.
  const { session } = await recorder.startSession({
    scope,
    sessionId,
    occurredAt,
    initiatedBy: PRICING_LEAD,
    agentActor: COST_AGENT_PRINCIPAL,
    agent: SESSION_AGENT,
    model: SESSION_MODEL,
    repository: SESSION_REPO,
    branch: "main",
    promptHash,
  });
  await session.recordPrompt({ promptHash });
  await session.recordToolCall({
    toolCallId: `tool_${sessionId}_read`,
    tool: "read_estimates",
    status: "succeeded",
    approval: "auto_allowed",
    reads: docFiles.map((file) => ({ id: file.id, pathHash: file.pathHash })),
  });
  await session.recordChangeProposal({ proposalId, acceptedPathHashes: docFiles.map((file) => file.pathHash) });
  await session.recordFileChange({
    sourceTreeId: `tree_${sessionId}`,
    causedByProposalId: proposalId,
    files: docFiles.map((file) => ({
      id: file.id,
      pathHash: file.pathHash,
      beforeHash: file.beforeHash,
      afterHash: sha256(`estimate/${file.id}/recalculated`),
      action: "upsert" as const,
    })),
  });
  const before = sink.take();
  const preDispatch = await dispatchBatchToCloud(before.records, before.edges);

  // Phase 2 — the actual governed re-estimations, joined to the session id. Each
  // entry is independent: a no-op or dispatch conflict on one must never abort the
  // whole session, so failures are skipped rather than thrown.
  const recalculated: string[] = [];
  for (const entry of targets) {
    try {
      const result = await runGovernedAction({ kind: "agent_reestimate", entryId: entry.id, sessionId });
      recalculated.push(result.entry.name);
    } catch {
      // Entry produced no governed change (or failed to dispatch); the session stands.
    }
  }

  // Phase 3 — a human pricing lead reviews and approves the agent's proposal.
  await session.recordReview({
    pullRequestId: `pr_${sessionId}`,
    reviewer: PRICING_LEAD,
    proposalId,
    decision: "approved",
  });
  const after = sink.take();
  const postDispatch = await dispatchBatchToCloud(after.records, after.edges);

  const dispatch = mergeDispatch(preDispatch, postDispatch);
  const view: AgentSessionView = {
    sessionId,
    occurredAt,
    agentLabel: `${SESSION_AGENT.name} (${COST_AGENT_PRINCIPAL.id})`,
    modelLabel: `${SESSION_MODEL.provider}/${SESSION_MODEL.name}`,
    recalculated,
    outcome: "approved",
    dispatch,
  };
  sessionFeed().unshift(view);
  return { session: view };
}

/**
 * Collapses the two recorder batch dispatches into one status for the UI: failed
 * if either failed, dispatched if either reached the Cloud, else local-only.
 */
function mergeDispatch(a: DispatchResult, b: DispatchResult): DispatchResult {
  if (a.status === "failed" || b.status === "failed") {
    const error = a.error ?? b.error;
    return { status: "failed", ...(error ? { error } : {}) };
  }
  if (a.status === "dispatched" || b.status === "dispatched") {
    return { status: "dispatched", dispatched: (a.dispatched ?? 0) + (b.dispatched ?? 0) };
  }
  return { status: "local_only" };
}
