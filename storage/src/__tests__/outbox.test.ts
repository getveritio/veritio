import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createGovernedChangeDraft, defineEntity, type AuditEventInput, type EvidenceEdgeInput } from "@veritio/core";
import { createFileEvidenceStore, type FileEvidenceStore } from "../file-store";
import {
  createFileOutboxAdapter,
  createPostgresOutboxAdapter,
  createOutboxDispatcher,
  dispatchOutboxEntry,
  type OutboxEvidenceTarget,
  type OutboxStoredEntry,
  type SqlOutboxExecutor,
  type SqlOutboxRow,
} from "../outbox";

const TENANT = "tenant_outbox";

describe("transactional evidence outbox", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "veritio-outbox-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("rolled-back host transactions emit no outbox rows or evidence records", async () => {
    const adapter = createFileOutboxAdapter(join(dir, "outbox"));
    const evidence = createFileEvidenceStore(join(dir, "evidence"));
    const draft = makeDraft("rollback");

    await expect(
      adapter.transaction(async (tx) => {
        await tx.enqueue({
          id: "outbox_rollback",
          tenantId: TENANT,
          payload: draft.outboxEntry,
        });
        throw new Error("host mutation rolled back");
      }),
    ).rejects.toThrow("host mutation rolled back");

    const dispatcher = createOutboxDispatcher({ adapter, target: evidence });
    expect(await adapter.list({ tenantId: TENANT })).toEqual([]);
    expect(await dispatcher.dispatchBatch({ tenantId: TENANT })).toEqual({ dispatched: 0, failed: 0 });
    expect(await evidence.listEvents()).toEqual([]);
    expect(await evidence.listEdges()).toEqual([]);
  });

  test("retrying a partially delivered outbox entry is idempotent", async () => {
    const adapter = createFileOutboxAdapter(join(dir, "outbox"));
    const evidence = createFileEvidenceStore(join(dir, "evidence"));
    const draft = makeDraft("retry");
    const flakyTarget = failOnceAfterSecondEvent(evidence);

    await adapter.transaction(async (tx) => {
      await tx.enqueue({
        id: "outbox_retry",
        tenantId: TENANT,
        payload: draft.outboxEntry,
      });
    });

    const firstAttempt = createOutboxDispatcher({ adapter, target: flakyTarget });
    expect(await firstAttempt.dispatchBatch({ tenantId: TENANT })).toEqual({ dispatched: 0, failed: 1 });
    expect(await evidence.listEvents()).toHaveLength(2);
    expect(await evidence.listEdges()).toHaveLength(0);

    const retry = createOutboxDispatcher({ adapter, target: evidence });
    expect(await retry.dispatchBatch({ tenantId: TENANT })).toEqual({ dispatched: 1, failed: 0 });
    expect(await retry.dispatchBatch({ tenantId: TENANT })).toEqual({ dispatched: 0, failed: 0 });

    expect(await evidence.listEvents()).toHaveLength(draft.events.length);
    expect(await evidence.listEdges()).toHaveLength(draft.edges.length);
    expect((await adapter.list({ tenantId: TENANT }))[0]).toMatchObject({
      id: "outbox_retry",
      tenantId: TENANT,
      status: "dispatched",
      attempts: 1,
    });
  });

  test("direct duplicate delivery does not create duplicate revisions or changes", async () => {
    const evidence = createFileEvidenceStore(join(dir, "evidence"));
    const draft = makeDraft("duplicate");

    await dispatchOutboxEntry(draft.outboxEntry, evidence);
    await dispatchOutboxEntry(draft.outboxEntry, evidence);

    const events = await evidence.listEvents();
    const edges = await evidence.listEdges();
    expect(events).toHaveLength(draft.events.length);
    expect(edges).toHaveLength(draft.edges.length);
    expect(events.map((record) => record.event.action).sort()).toEqual([
      "activity.recorded",
      "change.declared",
      "entity.revision.created",
    ]);
  });

  test("rejects payloads that do not match the outbox tenant scope", async () => {
    const adapter = createFileOutboxAdapter(join(dir, "outbox"));
    const draft = makeDraft("tenant-mismatch");
    draft.outboxEntry.records[0]!.scope = { tenantId: "other_tenant" };

    await expect(
      adapter.transaction(async (tx) => {
        await tx.enqueue({
          id: "outbox_bad_tenant",
          tenantId: TENANT,
          payload: draft.outboxEntry,
        });
      }),
    ).rejects.toThrow("outbox payload tenant mismatch");
  });

  test("SQL outbox adapter commits, rolls back, and dispatches through host transactions", async () => {
    const client = createSqlOutboxClient();
    const adapter = createPostgresOutboxAdapter({ client });
    const evidence = createFileEvidenceStore(join(dir, "evidence"));
    const draft = makeDraft("sql");

    await adapter.transaction(async (tx) => {
      await tx.enqueue({
        id: "outbox_sql_rollback",
        tenantId: TENANT,
        payload: draft.outboxEntry,
      });
      throw new Error("rollback sql outbox");
    }).catch(() => {});

    expect(await adapter.list({ tenantId: TENANT })).toEqual([]);

    await adapter.transaction(async (tx) => {
      await tx.enqueue({
        id: "outbox_sql_commit",
        tenantId: TENANT,
        payload: draft.outboxEntry,
      });
    });

    const dispatcher = createOutboxDispatcher({ adapter, target: evidence });
    expect(await dispatcher.dispatchBatch({ tenantId: TENANT })).toEqual({ dispatched: 1, failed: 0 });
    expect(await evidence.listEvents()).toHaveLength(draft.events.length);
    expect(await evidence.listEdges()).toHaveLength(draft.edges.length);
    expect((await adapter.list({ tenantId: TENANT }))[0]).toMatchObject({
      id: "outbox_sql_commit",
      status: "dispatched",
    });
  });
});

/**
 * Creates a governed-change draft whose minimized outbox payload contains no raw
 * customer email, giving the outbox tests a realistic revision payload.
 */
function makeDraft(suffix: string) {
  const entity = defineEntity<{
    id: string;
    amount: number;
    customerEmail: string;
  }>({
    authority: "example.billing",
    type: "invoice",
    schemaRef: "example.billing.invoice.v1",
    fieldSetRef: "example.billing.invoice.public.v1",
    identity: (row) => row.id,
    fields: {
      amount: { capture: "content_digest" },
      customerEmail: { capture: "keyed_digest" },
    },
  });

  return createGovernedChangeDraft({
    scope: { tenantId: TENANT, environment: "test" },
    entity,
    before: { id: `inv_${suffix}`, amount: 1200, customerEmail: "buyer@example.com" },
    after: { id: `inv_${suffix}`, amount: 1480, customerEmail: "buyer@example.com" },
    changedPaths: ["/amount"],
    change: {
      id: `change_${suffix}`,
      type: "invoice.adjusted",
      initiatedBy: { authority: "example.auth", kind: "principal", type: "user", id: "usr_123" },
    },
    activity: {
      id: `activity_${suffix}`,
      type: "invoice.adjustment",
      performedBy: { authority: "example.auth", kind: "principal", type: "user", id: "usr_123" },
    },
    producer: { authority: "example.billing", kind: "principal", type: "service", id: "billing-api" },
    occurredAt: "2026-06-23T10:00:00.000Z",
    idempotencyKeyHash: `sha256:${suffix}`,
    mutationBinding: "same_transaction",
    digestKeys: {
      keyedDigest: {
        keyVersion: "tenant-key-1",
        secret: "test-secret",
      },
    },
  });
}

/**
 * Simulates a dispatcher crash after the second event append. Retrying the same
 * outbox entry must rely on event IDs to replay safely without duplicate changes.
 */
function failOnceAfterSecondEvent(store: FileEvidenceStore): OutboxEvidenceTarget {
  let events = 0;
  let failed = false;
  return {
    async recordEvent(input: AuditEventInput) {
      const record = await store.recordEvent(input);
      events += 1;
      if (!failed && events === 2) {
        failed = true;
        throw new Error("dispatcher crashed after partial append");
      }
      return record;
    },
    async recordEdge(input: EvidenceEdgeInput) {
      return store.recordEdge(input);
    },
  };
}

/**
 * Provides an in-memory SQL executor that exercises the public SQL outbox
 * contract without requiring credentials in unit tests.
 */
function createSqlOutboxClient(): SqlOutboxExecutor & { rows: SqlOutboxRow[] } {
  const client: SqlOutboxExecutor & { rows: SqlOutboxRow[] } = {
    rows: [],
    async transaction(run) {
      const snapshot = client.rows.map((row) => ({ ...row }));
      try {
        return await run(client);
      } catch (error) {
        client.rows = snapshot;
        throw error;
      }
    },
    async execute(statement, params) {
      const sql = statement.toLowerCase();
      if (sql.startsWith("select payload_canonical")) {
        const [id] = params;
        return client.rows.filter((row) => row.id === id);
      }
      if (sql.startsWith("insert into")) {
        const [id, tenantId, payloadCanonical, entryJson, status, attempts, availableAt, createdAt, updatedAt, dispatchedAt, lastError] =
          params;
        if (client.rows.some((row) => row.id === id)) {
          throw new TypeError("duplicate outbox id");
        }
        client.rows.push({
          id: String(id),
          tenant_id: String(tenantId),
          payload_canonical: String(payloadCanonical),
          entry_json: String(entryJson),
          status: String(status),
          attempts: Number(attempts),
          available_at: String(availableAt),
          created_at: String(createdAt),
          updated_at: String(updatedAt),
          dispatched_at: dispatchedAt === null ? null : String(dispatchedAt),
          last_error: lastError === null ? null : String(lastError),
        });
        return [];
      }
      if (sql.startsWith("select entry_json") && sql.includes("status") && sql.includes("available_at")) {
        const [status, availableAt, tenantId, limit] = params;
        return limitRows(
          client.rows.filter(
            (row) =>
              row.status === status &&
              row.available_at <= String(availableAt) &&
              (tenantId === null || row.tenant_id === tenantId),
          ),
          limit,
        );
      }
      if (sql.startsWith("select entry_json")) {
        const [tenantId, limit] = params;
        return limitRows(
          client.rows.filter((row) => tenantId === null || row.tenant_id === tenantId),
          limit,
        );
      }
      if (sql.startsWith("update")) {
        const [entryJson, status, attempts, availableAt, updatedAt, dispatchedAt, lastError, id] = params;
        const row = client.rows.find((candidate) => candidate.id === id);
        if (!row) {
          throw new TypeError("outbox entry not found");
        }
        Object.assign(row, {
          entry_json: String(entryJson),
          status: String(status),
          attempts: Number(attempts),
          available_at: String(availableAt),
          updated_at: String(updatedAt),
          dispatched_at: dispatchedAt === null ? null : String(dispatchedAt),
          last_error: lastError === null ? null : String(lastError),
        });
        return [];
      }
      throw new TypeError(`unexpected SQL: ${statement}`);
    },
  };
  return client;
}

/**
 * Sorts and limits SQL mock rows in the same order the real outbox queries use.
 */
function limitRows(rows: SqlOutboxRow[], limit: unknown): SqlOutboxRow[] {
  const sorted = rows.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  return limit === null || limit === undefined ? sorted : sorted.slice(0, Number(limit));
}
