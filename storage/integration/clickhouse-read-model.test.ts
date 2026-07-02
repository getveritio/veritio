import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type AuditRecord, canonicalJson, createAuditEvent, MemoryAuditStore } from "@veritio/core";
import { type ClickHouseExecutor, createClickHouseAuditReadModel } from "../src/clickhouse-read-model";

const endpoint = process.env.VERITIO_CLICKHOUSE_TEST_ENDPOINT;
const user = process.env.VERITIO_CLICKHOUSE_TEST_USER ?? "veritio";
const password = process.env.VERITIO_CLICKHOUSE_TEST_PASSWORD ?? "veritio";
const database = process.env.VERITIO_CLICKHOUSE_TEST_DATABASE ?? "veritio";

if (endpoint) {
  defineClickHouseLiveSuite(endpoint);
}

/**
 * Proves the derived read model against a real ClickHouse HTTP interface
 * (container in `storage/docker-compose.yml`): parameter binding, JSONEachRow
 * projection, FINAL-deduplicated grouping after an at-least-once replay, and
 * byte-exact record round-trips.
 */
function defineClickHouseLiveSuite(liveEndpoint: string): void {
  const client = createFetchClickHouseExecutor(liveEndpoint);
  const tableName = `veritio_ch_read_model_${randomUUID().replaceAll("-", "")}`;

  describe("clickhouse read model live", () => {
    test("projects, deduplicates replays, and serves episode/subject groupings", async () => {
      await waitForConnection();
      const tenantId = "org_ch_live";
      const readModel = createClickHouseAuditReadModel({ client, tableName });
      const records = await seedEpisodeRecords(tenantId);

      try {
        await readModel.ensureSchema();
        await readModel.project(records);
        // At-least-once replay: the same projection twice must not
        // double-count once ReplacingMergeTree + FINAL deduplicate.
        await readModel.project(records);

        const episodes = await readModel.listEpisodes(tenantId);
        expect(episodes.map((episode) => [episode.activityEpisodeId, episode.stepCount])).toEqual([
          ["ep_alpha", 3],
          ["ep_beta", 2],
        ]);

        const steps = await readModel.listEpisodeSteps(tenantId, "ep_alpha");
        expect(steps.map((record) => canonicalJson(record))).toEqual(
          records.slice(0, 3).map((record) => canonicalJson(record)),
        );

        const subjectRecords = await readModel.listBySubject(tenantId, "subj_dsar");
        expect(subjectRecords.map((record) => record.event.id)).toEqual(["evt_004", "evt_005"]);
      } finally {
        await client.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
      }
    }, 60_000);
  });

  /** Retries initial connectivity so container startup delay cannot make the suite flaky. */
  async function waitForConnection(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await client.execute("SELECT 1");
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    throw lastError;
  }
}

/**
 * Seeds one tenant chain: sequences 1-3 in episode ep_alpha, 4-5 in ep_beta,
 * with the DSAR subject key only on the ep_beta events.
 */
async function seedEpisodeRecords(tenantId: string): Promise<AuditRecord[]> {
  const store = new MemoryAuditStore();
  for (let index = 1; index <= 5; index += 1) {
    const episodeId = index <= 3 ? "ep_alpha" : "ep_beta";
    await store.append(
      createAuditEvent({
        id: `evt_${String(index).padStart(3, "0")}`,
        occurredAt: `2026-06-10T00:00:0${index}.000Z`,
        actor: { type: "ai_agent", id: "agent_claude" },
        action: "agent.tool.called",
        target: { type: "tool_call", id: `tc_${index}` },
        scope: { tenantId, environment: "test" },
        metadata: {
          sessionId: "sess_live",
          activityEpisodeId: episodeId,
          ...(episodeId === "ep_beta" ? { subjectId: "subj_dsar" } : {}),
        },
      }),
    );
  }
  return store.list({ tenantId });
}

/**
 * Host-owned ClickHouseExecutor over the HTTP interface: SQL travels as the
 * request body (or as the `query` URL parameter when the body carries
 * JSONEachRow data), values bind via `param_<name>` URL parameters, and
 * credentials go in ClickHouse auth headers. Mirrors what a host app or the
 * cloud repo would implement around fetch.
 */
function createFetchClickHouseExecutor(liveEndpoint: string): ClickHouseExecutor {
  return {
    async execute(sql, options) {
      const url = new URL(liveEndpoint);
      url.searchParams.set("database", database);
      for (const [name, value] of Object.entries(options?.params ?? {})) {
        url.searchParams.set(`param_${name}`, value);
      }
      let body = sql;
      if (options?.body !== undefined) {
        url.searchParams.set("query", sql);
        body = options.body;
      }
      const response = await fetch(url, {
        method: "POST",
        headers: { "X-ClickHouse-User": user, "X-ClickHouse-Key": password },
        body,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`clickhouse request failed with status ${response.status}: ${text.slice(0, 200)}`);
      }
      return text;
    },
  };
}
