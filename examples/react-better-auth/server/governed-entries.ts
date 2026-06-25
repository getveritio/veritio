import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGovernedChangeDraft, defineEntity, type EvidenceRef, type GovernedEntity } from "@veritio/core";
import { createFileOutboxAdapter, type OutboxAdapter } from "@veritio/storage";
import {
  cloudPublicConfig,
  cloudTenantId,
  dispatchOutboxToCloud,
  type CloudPublicConfig,
  type DispatchResult,
} from "./cloud-ingest";

/**
 * The governed-change engine for the example. A real UI action (create, edit,
 * run cost agent, roll back) is turned into a governed `Change` here: the SDK
 * `createGovernedChangeDraft` produces the `change.declared` / `activity.recorded`
 * / `entity.revision.created` records the Cloud Changes surface projects, the
 * draft is enqueued into a transactional outbox in the same step as the local
 * mutation, and the outbox is then dispatched server-to-server to hosted ingest.
 *
 * Every revision carries a monotonic `version` governed field, so even a
 * rollback that restores prior business values is a genuinely new revision with
 * a distinct state digest — the entity is versioned, exactly like a real system.
 * Identity/tenant are server-owned; the browser never supplies them. This module
 * lives on the Express side and is the only place that reads cloud env config.
 */

/** The governed business row. `customerEmail` is captured as a keyed digest. */
export type EntryRow = {
  id: string;
  name: string;
  quantity: number;
  monthlyPrice: number;
  customerEmail: string;
  status: "active" | "archived";
  version: number;
};

const projectEntry: GovernedEntity<EntryRow> = defineEntity<EntryRow>({
  authority: "veritio.example",
  type: "project_entry",
  schemaRef: "veritio.example/project_entry@1",
  fieldSetRef: "project-entry-governed-fields@1",
  identity: (row) => row.id,
  fields: {
    name: { capture: "full" },
    quantity: { capture: "full" },
    monthlyPrice: { capture: "full" },
    status: { capture: "full" },
    version: { capture: "full" },
    // Low-entropy PII: stored as a tenant-keyed HMAC digest, never raw, so the
    // evidence shows "changed" without revealing the address (design §3.9).
    customerEmail: { capture: "keyed_digest" },
  },
});

// Demo HMAC material lives at the server boundary; real apps inject a rotated,
// tenant-scoped secret. It never reaches the browser and never enters evidence.
const DIGEST_KEYS = { keyedDigest: { keyVersion: "example-key-1", secret: "react-example-keyed-digest-secret" } };

const PRODUCER: EvidenceRef = {
  authority: "veritio.example",
  kind: "principal",
  type: "service",
  id: "react-governed-crud",
};
const COST_AGENT: EvidenceRef = {
  authority: "veritio.example.ai",
  kind: "principal",
  type: "ai_agent",
  id: "cost_agent_7",
};
const COST_RATE = 12350;

/** Authority-qualified user ref for the server-resolved actor. */
function userRef(id: string): EvidenceRef {
  return { authority: "veritio.example.auth", kind: "principal", type: "user", id };
}

/** The genesis lineage ref for an entry that has no captured revision yet. */
function genesisRevisionRef(entryId: string): EvidenceRef {
  return { authority: "veritio", kind: "revision", type: "project_entry", id: `rev_project_entry_${entryId}_genesis` };
}

export interface EntryRevisionView {
  revisionId: string;
  version: number;
  quantity: number;
  monthlyPrice: number;
  status: "active" | "archived";
  changeId: string;
  changeType: string;
  actorLabel: string;
  occurredAt: string;
}

export type EntryView = EntryRow & {
  revisionRef: EvidenceRef;
  revisions: EntryRevisionView[];
};

export interface ChangeFeedItem {
  changeId: string;
  changeType: string;
  entryId: string;
  entryName: string;
  actorLabel: string;
  occurredAt: string;
  dispatch: DispatchResult;
}

export type GovernedActionKind = "create" | "update" | "agent_recalc" | "agent_reestimate" | "rollback";

export interface GovernedActionInput {
  kind: GovernedActionKind;
  entryId: string;
  name?: string;
  quantity?: number;
  monthlyPrice?: number;
  customerEmail?: string;
  status?: "active" | "archived";
  rollbackToRevisionId?: string;
  actorId?: string;
  /**
   * When set, stamps `metadata.sessionId` on this change's events so the Cloud
   * groups it under an agent session (see `governed-session.ts`). `sessionId` is
   * non-PII and is not a reserved Veritio context key, so it is carried verbatim.
   */
  sessionId?: string;
}

export interface GovernedActionResult {
  changeId: string;
  changeType: string;
  entry: EntryView;
  dispatch: DispatchResult;
  cloud: CloudPublicConfig;
}

/** Reuses one entry store across tsx-watch server reloads. */
function entryStore(): Map<string, EntryView> {
  const ref = globalThis as typeof globalThis & { __veritioGovernedEntries?: Map<string, EntryView> };
  if (!ref.__veritioGovernedEntries) {
    ref.__veritioGovernedEntries = seedEntries();
  }
  return ref.__veritioGovernedEntries;
}

/** Reuses one change feed (newest first) across tsx-watch server reloads. */
function changeFeed(): ChangeFeedItem[] {
  const ref = globalThis as typeof globalThis & { __veritioGovernedFeed?: ChangeFeedItem[] };
  ref.__veritioGovernedFeed ??= [];
  return ref.__veritioGovernedFeed;
}

/** Reuses one durable file outbox across tsx-watch server reloads. */
function outbox(): OutboxAdapter {
  const ref = globalThis as typeof globalThis & { __veritioGovernedOutbox?: OutboxAdapter };
  ref.__veritioGovernedOutbox ??= createFileOutboxAdapter(join(tmpdir(), "veritio-react-example-outbox"));
  return ref.__veritioGovernedOutbox;
}

/**
 * A stable per-process run id, carried in change/activity ids. A real app's
 * versions are globally monotonic, so its ids never collide; this example's
 * in-memory store resets to v1 on each restart, which would otherwise regenerate
 * a deterministic id the persistent Cloud already holds (a 409 append conflict).
 * Scoping ids to the launch keeps each run's evidence distinct while preserving
 * idempotency WITHIN a run (an outbox retry re-sends the same id). It is reused
 * across tsx-watch server reloads so a restart-in-place does not change ids
 * mid-run.
 */
function runId(): string {
  const ref = globalThis as typeof globalThis & { __veritioRunId?: string };
  ref.__veritioRunId ??= randomUUID().replace(/-/g, "").slice(0, 8);
  return ref.__veritioRunId;
}

/** Seeds two starting entries (no captured history until the first change). */
function seedEntries(): Map<string, EntryView> {
  const map = new Map<string, EntryView>();
  for (const seed of [
    {
      id: "tower_a",
      name: "Tower A — structural estimate",
      quantity: 8,
      monthlyPrice: 120000,
      customerEmail: "buyer@acme.example",
    },
    {
      id: "tower_b",
      name: "Tower B — facade package",
      quantity: 4,
      monthlyPrice: 52000,
      customerEmail: "ops@acme.example",
    },
  ]) {
    map.set(seed.id, {
      ...seed,
      status: "active",
      version: 1,
      revisionRef: genesisRevisionRef(seed.id),
      revisions: [],
    });
  }
  return map;
}

/** Lists current governed entities with their captured revision history. */
export function listEntries(): EntryView[] {
  return [...entryStore().values()].map((entry) => ({ ...entry, revisions: [...entry.revisions] }));
}

/** Lists the most recent governed changes and their dispatch outcomes. */
export function listChangeFeed(limit = 25): ChangeFeedItem[] {
  return changeFeed().slice(0, limit);
}

/** The browser-safe cloud configuration (no token). */
export function cloudStatus(): CloudPublicConfig {
  return cloudPublicConfig();
}

/**
 * Runs one governed action end to end: resolve before/after rows, build the
 * governed-change draft, apply the local mutation AND enqueue the outbox entry
 * together, then dispatch the outbox to hosted ingest. Returns the new entry
 * state plus the dispatch outcome for live UI feedback.
 */
export async function runGovernedAction(input: GovernedActionInput): Promise<GovernedActionResult> {
  const store = entryStore();
  const existing = store.get(input.entryId);
  if (input.kind !== "create" && !existing) {
    throw new TypeError("entry not found");
  }
  if (input.kind === "create" && existing) {
    throw new TypeError("entry already exists");
  }

  const before = existing ? toRow(existing) : undefined;
  const after = nextRow(input, existing);
  const changedPaths = businessChangedPaths(before, after);
  if (input.kind !== "create" && changedPaths.length === 0) {
    throw new TypeError("no governed fields changed");
  }

  const isAgent = input.kind === "agent_recalc" || input.kind === "agent_reestimate";
  const actor = isAgent ? COST_AGENT : userRef(input.actorId ?? "usr_pricing_admin");
  const changeType = changeTypeFor(input.kind);
  const changeId = `chg_${input.entryId}_${runId()}_v${after.version}`;
  const activityId = `act_${input.entryId}_${runId()}_v${after.version}`;
  const occurredAt = new Date().toISOString();

  const draft = createGovernedChangeDraft<EntryRow>({
    scope: { tenantId: cloudTenantId(), environment: "reference" },
    entity: projectEntry,
    before,
    after,
    changedPaths: changedPaths.length > 0 ? changedPaths : ["/name"],
    change: { id: changeId, type: changeType, initiatedBy: userRef(input.actorId ?? "usr_pricing_admin") },
    activity: { id: activityId, type: activityTypeFor(input.kind), performedBy: actor },
    producer: PRODUCER,
    occurredAt,
    idempotencyKeyHash: `sha256:${changeId}`,
    mutationBinding: "same_transaction",
    expectedParentRevisionRef: existing ? existing.revisionRef : undefined,
    ...(input.sessionId ? { metadata: { sessionId: input.sessionId } } : {}),
    digestKeys: DIGEST_KEYS,
  });

  // Enqueue the evidence draft FIRST, then apply the local business mutation —
  // the transactional-outbox boundary (design §7.1/§7.4). A rejected enqueue
  // (e.g. an idempotency conflict on a re-used change id) must never leave the
  // in-memory entry half-advanced to a new revision, so the store is only
  // mutated after the outbox transaction commits.
  await outbox().transaction(async (tx) => {
    await tx.enqueue({ id: changeId, tenantId: cloudTenantId(), payload: draft.outboxEntry });
  });
  const view = applyRevision(after, draft.revision.ref, {
    revisionId: draft.revision.ref.id,
    version: after.version,
    quantity: after.quantity,
    monthlyPrice: after.monthlyPrice,
    status: after.status,
    changeId,
    changeType,
    actorLabel: actorLabel(actor),
    occurredAt,
  });

  const dispatch = await dispatchOutboxToCloud(outbox(), cloudTenantId());
  changeFeed().unshift({
    changeId,
    changeType,
    entryId: input.entryId,
    entryName: after.name,
    actorLabel: actorLabel(actor),
    occurredAt,
    dispatch,
  });

  return { changeId, changeType, entry: view, dispatch, cloud: cloudPublicConfig() };
}

/** Strips the view-only fields back to the governed row for the SDK. */
function toRow(view: EntryView): EntryRow {
  return {
    id: view.id,
    name: view.name,
    quantity: view.quantity,
    monthlyPrice: view.monthlyPrice,
    customerEmail: view.customerEmail,
    status: view.status,
    version: view.version,
  };
}

/** Computes the after-row for each action kind, bumping the version. */
function nextRow(input: GovernedActionInput, existing: EntryView | undefined): EntryRow {
  if (input.kind === "create") {
    return {
      id: input.entryId,
      name: input.name?.trim() || "New project entry",
      quantity: clampNumber(input.quantity, 1),
      monthlyPrice: clampNumber(input.monthlyPrice, 0),
      customerEmail: input.customerEmail?.trim() || "buyer@example.com",
      status: "active",
      version: 1,
    };
  }

  const base = toRow(existing as EntryView);
  if (input.kind === "agent_recalc") {
    return { ...base, monthlyPrice: Math.round(base.quantity * COST_RATE), version: base.version + 1 };
  }
  if (input.kind === "agent_reestimate") {
    // The cost agent refines the takeoff (quantity) and reprices — a repeatable
    // governed action that always advances the estimate, so an agent session can
    // re-run without producing a no-op.
    const quantity = base.quantity + 1;
    return { ...base, quantity, monthlyPrice: Math.round(quantity * COST_RATE), version: base.version + 1 };
  }
  if (input.kind === "rollback") {
    const target = (existing as EntryView).revisions.find((rev) => rev.revisionId === input.rollbackToRevisionId);
    if (!target) {
      throw new TypeError("rollback target revision not found");
    }
    return {
      ...base,
      quantity: target.quantity,
      monthlyPrice: target.monthlyPrice,
      status: target.status,
      version: base.version + 1,
    };
  }
  // update
  return {
    ...base,
    name: input.name?.trim() || base.name,
    quantity: input.quantity === undefined ? base.quantity : clampNumber(input.quantity, 1),
    monthlyPrice: input.monthlyPrice === undefined ? base.monthlyPrice : clampNumber(input.monthlyPrice, 0),
    status: input.status ?? base.status,
    version: base.version + 1,
  };
}

/** Applies the new revision to the entry store and returns the updated view. */
function applyRevision(row: EntryRow, revisionRef: EvidenceRef, revision: EntryRevisionView): EntryView {
  const store = entryStore();
  const previous = store.get(row.id);
  const view: EntryView = {
    ...row,
    customerEmail: row.customerEmail,
    revisionRef,
    revisions: [...(previous?.revisions ?? []), revision],
  };
  store.set(row.id, view);
  return { ...view, revisions: [...view.revisions] };
}

/** Business-meaningful changed paths (the version bump is bookkeeping). */
function businessChangedPaths(before: EntryRow | undefined, after: EntryRow): string[] {
  const fields: Array<keyof EntryRow> = ["name", "quantity", "monthlyPrice", "customerEmail", "status"];
  if (!before) {
    return fields.map((field) => `/${String(field)}`);
  }
  return fields.filter((field) => before[field] !== after[field]).map((field) => `/${String(field)}`);
}

function changeTypeFor(kind: GovernedActionKind): string {
  if (kind === "create") return "project_entry.created";
  if (kind === "agent_recalc" || kind === "agent_reestimate") return "project_entry.estimate.recalculation";
  if (kind === "rollback") return "project_entry.rollback";
  return "project_entry.updated";
}

function activityTypeFor(kind: GovernedActionKind): string {
  if (kind === "agent_recalc" || kind === "agent_reestimate") return "computation.project_cost_estimate";
  if (kind === "rollback") return "project_entry.rollback";
  if (kind === "create") return "project_entry.create";
  return "project_entry.update";
}

function actorLabel(actor: EvidenceRef): string {
  return `${actor.id} (${actor.type})`;
}

/** Rounds and floors a numeric input to a safe non-negative integer-ish value. */
function clampNumber(value: number | undefined, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.round(value));
}
