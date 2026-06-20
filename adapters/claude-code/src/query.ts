import type { AuditEvent, AuditRecord, EvidenceEdge, EvidenceEdgeRecord, VerificationResult } from "@veritio/core";
import type { FileEvidenceStore } from "@veritio/storage";

/**
 * Read/query side of the adapter: groups the captured evidence into agent sessions
 * and exports verifiable bundles. The reference MCP (mcp.ts) exposes these. Session
 * grouping is a `metadata.sessionId` group-by — the same robust convention the hook
 * stamps and the hosted read model uses.
 */

export type SessionOutcome = "deployed" | "approved" | "changes_requested" | "waived" | "in_progress";

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  actorId: string;
  humanId: string | null;
  agent: { name?: string; version?: string } | null;
  model: { provider?: string; name?: string } | null;
  branch: string | null;
  eventCount: number;
  changeCount: number;
  outcome: SessionOutcome;
}

export interface SessionGraph {
  nodes: { type: string; id: string }[];
  edges: { id: string; from: { type: string; id: string }; relation: string; to: { type: string; id: string } }[];
}

function sessionIdOf(event: AuditEvent): string | null {
  const value = (event.metadata as Record<string, unknown> | undefined)?.sessionId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function metaObject(event: AuditEvent, key: string): Record<string, unknown> | null {
  const value = (event.metadata as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function deriveOutcome(actions: Set<string>): SessionOutcome {
  if (actions.has("deploy.deployed")) return "deployed";
  if (actions.has("review.approval.recorded")) return "approved";
  if (actions.has("review.finding.created")) return "changes_requested";
  if (actions.has("review.waiver.recorded")) return "waived";
  return "in_progress";
}

/** Summarizes the tenant's sessions, optionally filtered to one `day` (YYYY-MM-DD). */
export async function listSessions(store: FileEvidenceStore, opts: { day?: string } = {}): Promise<SessionSummary[]> {
  const [eventRecords, edgeRecords] = await Promise.all([store.listEvents(), store.listEdges()]);
  const groups = new Map<string, AuditRecord[]>();
  for (const record of eventRecords) {
    if (opts.day && record.event.occurredAt.slice(0, 10) !== opts.day) continue;
    const id = sessionIdOf(record.event);
    if (!id) continue;
    const bucket = groups.get(id);
    if (bucket) bucket.push(record);
    else groups.set(id, [record]);
  }

  const summaries: SessionSummary[] = [];
  for (const [sessionId, records] of groups) {
    const start = records.find((r) => r.event.action === "agent.session.started") ?? records[0]!;
    const agent = metaObject(start.event, "agent");
    const model = metaObject(start.event, "model");
    const branch = (start.event.metadata as Record<string, unknown>).branch;
    const paths = new Set<string>();
    for (const r of records) {
      const files = (r.event.metadata as Record<string, unknown>).files;
      if (Array.isArray(files)) {
        for (const f of files) {
          const p = (f as Record<string, unknown> | null)?.pathHash;
          if (typeof p === "string") paths.add(p);
        }
      }
    }
    const human = edgeRecords.find(
      (r) =>
        r.edge.from.type === "agent_session" &&
        r.edge.from.id === sessionId &&
        r.edge.relation === "caused_by" &&
        r.edge.to.type === "actor",
    );
    summaries.push({
      sessionId,
      startedAt: start.event.occurredAt,
      endedAt: records.reduce(
        (max, r) => (r.event.occurredAt > max ? r.event.occurredAt : max),
        start.event.occurredAt,
      ),
      actorId: start.event.actor.id,
      humanId: human?.edge.to.id ?? null,
      agent: pick(agent, ["name", "version"]),
      model: pick(model, ["provider", "name"]),
      branch: typeof branch === "string" ? branch : null,
      eventCount: records.length,
      changeCount: paths.size,
      outcome: deriveOutcome(new Set(records.map((r) => r.event.action))),
    });
  }
  return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Returns one session's event records plus its projected provenance graph. */
export async function getSession(
  store: FileEvidenceStore,
  sessionId: string,
): Promise<{ sessionId: string; events: AuditRecord[]; graph: SessionGraph }> {
  const [eventRecords, edgeRecords] = await Promise.all([store.listEvents(), store.listEdges()]);
  const events = eventRecords.filter((r) => sessionIdOf(r.event) === sessionId);
  const entityIds = new Set<string>([sessionId, ...events.map((r) => r.event.target.id)]);
  const edges = edgeRecords
    .map((r) => r.edge)
    .filter((edge) => entityIds.has(edge.from.id) || entityIds.has(edge.to.id));
  return { sessionId, events, graph: projectGraph(edges) };
}

/** Builds a verifiable evidence bundle for a session: its records + the chain verdict. */
export async function exportSession(
  store: FileEvidenceStore,
  sessionId: string,
): Promise<{
  sessionId: string;
  events: AuditRecord[];
  edges: EvidenceEdgeRecord[];
  verification: { ok: boolean; audit: VerificationResult; edges: VerificationResult };
}> {
  const [eventRecords, edgeRecords, verification] = await Promise.all([
    store.listEvents(),
    store.listEdges(),
    store.verify(),
  ]);
  const events = eventRecords.filter((r) => sessionIdOf(r.event) === sessionId);
  const entityIds = new Set<string>([sessionId, ...events.map((r) => r.event.target.id)]);
  const edges = edgeRecords.filter((r) => entityIds.has(r.edge.from.id) || entityIds.has(r.edge.to.id));
  return { sessionId, events, edges, verification };
}

/** Dedupes edge endpoints into nodes and projects edges (mirrors the hosted projection). */
function projectGraph(edges: EvidenceEdge[]): SessionGraph {
  const nodes = new Map<string, { type: string; id: string }>();
  const add = (entity: { type: string; id: string }) => {
    const key = `${entity.type}:${entity.id}`;
    if (!nodes.has(key)) nodes.set(key, { type: entity.type, id: entity.id });
  };
  const projected = edges.map((edge) => {
    add(edge.from);
    add(edge.to);
    return {
      id: edge.id,
      from: { type: edge.from.type, id: edge.from.id },
      relation: edge.relation,
      to: { type: edge.to.type, id: edge.to.id },
    };
  });
  return { nodes: [...nodes.values()], edges: projected };
}

/**
 * Projects the given string-valued keys of a metadata object into a new object,
 * omitting keys that are missing/non-string (never an explicit `undefined`, which
 * `exactOptionalPropertyTypes` forbids), or null when the source object is absent.
 */
function pick<K extends string>(source: Record<string, unknown> | null, keys: K[]): Partial<Record<K, string>> | null {
  if (!source) return null;
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}
