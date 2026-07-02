import { describe, expect, test } from "bun:test";
import { type AuditRecord, canonicalJson, createAuditEvent, hashAuditRecord, MemoryAuditStore } from "@veritio/core";
import {
  type ClickHouseExecutor,
  clickHouseAuditReadModelSchemaSql,
  createClickHouseAuditReadModel,
} from "../clickhouse-read-model";

const TENANT = "org_readmodel";

interface ExecutedCall {
  sql: string;
  params?: Record<string, string>;
  body?: string;
}

/** Fake ClickHouse executor capturing calls and replaying queued JSONEachRow responses. */
function createFakeExecutor(): ClickHouseExecutor & { calls: ExecutedCall[]; responses: string[] } {
  const calls: ExecutedCall[] = [];
  const responses: string[] = [];
  return {
    calls,
    responses,
    async execute(sql, options) {
      calls.push({ sql, ...(options ?? {}) });
      return responses.shift() ?? "";
    },
  };
}

/** Seeds hash-chained records carrying the metadata grouping keys the read model extracts. */
async function seedRecords(count: number, episodeId: string): Promise<AuditRecord[]> {
  const store = new MemoryAuditStore();
  for (let index = 1; index <= count; index += 1) {
    await store.append(
      createAuditEvent({
        id: `evt_${episodeId}_${String(index).padStart(3, "0")}`,
        occurredAt: `2026-06-10T00:00:0${index % 10}.000Z`,
        actor: { type: "ai_agent", id: "agent_claude" },
        action: "agent.tool.called",
        target: { type: "tool_call", id: `tc_${index}` },
        scope: { tenantId: TENANT, environment: "test" },
        metadata: { sessionId: "sess_01", activityEpisodeId: episodeId, subjectId: "subj_42" },
      }),
    );
  }
  return store.list({ tenantId: TENANT });
}

describe("clickhouse audit read model", () => {
  test("schema stores canonical bytes as raw String on a ReplacingMergeTree", () => {
    const sql = clickHouseAuditReadModelSchemaSql();
    expect(sql).toContain("record_json String");
    expect(sql).toContain("ENGINE = ReplacingMergeTree");
    expect(sql).toContain("ORDER BY (tenant_id, sequence)");
    expect(() => clickHouseAuditReadModelSchemaSql("bad-name")).toThrow("tableName must be a simple identifier");
  });

  test("ensureSchema issues the CREATE TABLE statement", async () => {
    const client = createFakeExecutor();
    const readModel = createClickHouseAuditReadModel({ client, tableName: "custom_read_model" });
    await readModel.ensureSchema();
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.sql).toContain("CREATE TABLE IF NOT EXISTS `custom_read_model`");
  });

  test("project inserts JSONEachRow rows with extracted grouping keys and canonical record bytes", async () => {
    const client = createFakeExecutor();
    const readModel = createClickHouseAuditReadModel({ client });
    const records = await seedRecords(2, "ep_alpha");

    await expect(readModel.project(records)).resolves.toBe(2);
    await expect(readModel.project([])).resolves.toBe(0);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0]!;
    expect(call.sql).toBe("INSERT INTO `veritio_audit_read_model` FORMAT JSONEachRow");
    const rows = call
      .body!.split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT,
      sequence: 1,
      action: "agent.tool.called",
      session_id: "sess_01",
      activity_episode_id: "ep_alpha",
      subject_id: "subj_42",
    });
    expect(rows[0]!.record_json).toBe(canonicalJson(records[0]!));
  });

  test("project fails closed on tampered or tenantless records without writing", async () => {
    const client = createFakeExecutor();
    const readModel = createClickHouseAuditReadModel({ client });
    const [record] = await seedRecords(1, "ep_alpha");

    const tampered = { ...record!, appendedAt: "2030-01-01T00:00:00.000Z" };
    await expect(readModel.project([tampered])).rejects.toThrow("audit record integrity check failed");

    const tenantlessEvent = createAuditEvent({
      id: "evt_tenantless",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_1" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_x" },
      metadata: {},
    });
    const withoutHash = {
      event: tenantlessEvent,
      sequence: 1,
      previousHash: null,
      hashAlgorithm: "sha256" as const,
      canonicalization: "veritio-json-v1" as const,
      appendedAt: "2026-06-10T00:00:00.000Z",
      idempotencyKeyHash: "0".repeat(64),
    };
    const tenantless: AuditRecord = { ...withoutHash, hash: hashAuditRecord(withoutHash) };
    await expect(readModel.project([tenantless])).rejects.toThrow("scope.tenantId is required");
    expect(client.calls).toHaveLength(0);
  });

  test("listEpisodeSteps binds values as query parameters and revalidates returned records", async () => {
    const client = createFakeExecutor();
    const readModel = createClickHouseAuditReadModel({ client });
    const records = await seedRecords(2, "ep_alpha");
    client.responses.push(records.map((record) => JSON.stringify({ record_json: canonicalJson(record) })).join("\n"));

    const steps = await readModel.listEpisodeSteps(TENANT, "ep_alpha");

    expect(steps.map((record) => canonicalJson(record))).toEqual(records.map((record) => canonicalJson(record)));
    const call = client.calls[0]!;
    expect(call.sql).toContain("{tenantId:String}");
    expect(call.sql).toContain("{activityEpisodeId:String}");
    expect(call.sql).not.toContain("ep_alpha");
    expect(call.params).toEqual({ tenantId: TENANT, activityEpisodeId: "ep_alpha" });
  });

  test("fails closed when the read model returns tampered record bytes", async () => {
    const client = createFakeExecutor();
    const readModel = createClickHouseAuditReadModel({ client });
    const [record] = await seedRecords(1, "ep_alpha");
    const tampered = { ...record!, sequence: 99 };
    client.responses.push(JSON.stringify({ record_json: canonicalJson(tampered) }));

    await expect(readModel.listEpisodeSteps(TENANT, "ep_alpha")).rejects.toThrow(
      "read-model audit record integrity check failed",
    );
  });

  test("listEpisodes parses summaries including quoted UInt64 counters", async () => {
    const client = createFakeExecutor();
    const readModel = createClickHouseAuditReadModel({ client });
    client.responses.push(
      [
        JSON.stringify({
          activity_episode_id: "ep_alpha",
          step_count: "3",
          first_occurred_at: "2026-06-10T00:00:01.000Z",
          last_occurred_at: "2026-06-10T00:00:03.000Z",
        }),
        JSON.stringify({
          activity_episode_id: "ep_beta",
          step_count: 2,
          first_occurred_at: "2026-06-10T00:00:04.000Z",
          last_occurred_at: "2026-06-10T00:00:05.000Z",
        }),
      ].join("\n"),
    );

    const episodes = await readModel.listEpisodes(TENANT);

    expect(episodes).toEqual([
      {
        activityEpisodeId: "ep_alpha",
        stepCount: 3,
        firstOccurredAt: "2026-06-10T00:00:01.000Z",
        lastOccurredAt: "2026-06-10T00:00:03.000Z",
      },
      {
        activityEpisodeId: "ep_beta",
        stepCount: 2,
        firstOccurredAt: "2026-06-10T00:00:04.000Z",
        lastOccurredAt: "2026-06-10T00:00:05.000Z",
      },
    ]);
    expect(client.calls[0]!.params).toEqual({ tenantId: TENANT });
  });

  test("listBySubject binds the subject parameter and returns validated records", async () => {
    const client = createFakeExecutor();
    const readModel = createClickHouseAuditReadModel({ client });
    const records = await seedRecords(1, "ep_alpha");
    client.responses.push(JSON.stringify({ record_json: canonicalJson(records[0]!) }));

    const found = await readModel.listBySubject(TENANT, "subj_42");

    expect(found.map((record) => canonicalJson(record))).toEqual([canonicalJson(records[0]!)]);
    expect(client.calls[0]!.params).toEqual({ tenantId: TENANT, subjectId: "subj_42" });
    await expect(readModel.listBySubject(TENANT, " ")).rejects.toThrow("subjectId is required");
  });
});
