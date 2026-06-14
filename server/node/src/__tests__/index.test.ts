import { describe, expect, test } from "bun:test";
import {
  LocalEvidenceStore,
  createWorkbenchApp,
  handleMcpRequest,
  runIntegrationScenario,
} from "../index";

const tenantId = "org_local_123";

function eventInput(id = "evt_local_01") {
  return {
    id,
    occurredAt: "2026-06-14T00:00:00.000Z",
    actor: { type: "user" as const, id: "usr_123" },
    action: "org.member.invited",
    target: { type: "organization", id: tenantId },
    scope: { tenantId, environment: "test" },
    purpose: "access_management",
    dataCategories: ["account"],
    retention: "security_1y",
    metadata: { invitedEmail: "member@example.invalid", role: "viewer" },
  };
}

function edgeInput(id = "edge_local_01") {
  return {
    id,
    occurredAt: "2026-06-14T00:00:01.000Z",
    scope: { tenantId, environment: "test" },
    from: { type: "actor" as const, id: "usr_123", actorType: "user" as const },
    relation: "created" as const,
    to: { type: "runtime_event" as const, id: "evt_local_01" },
    metadata: { reason: "member_invite" },
  };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("LocalEvidenceStore", () => {
  test("records events and edges, projects a graph, verifies chains, and previews an export bundle", async () => {
    const store = new LocalEvidenceStore();

    const eventRecord = await store.recordEvent(eventInput(), { idempotencyKey: "invite:usr_123" });
    const edgeRecord = await store.recordEdge(edgeInput(), { idempotencyKey: "edge:usr_123:evt_local_01" });

    expect(eventRecord.event.metadata).toEqual({ invitedEmail: "[redacted]", role: "viewer" });
    expect(edgeRecord.edge.relation).toBe("created");
    expect(await store.listEvents({ tenantId })).toEqual([eventRecord]);
    expect(await store.listEdges({ tenantId })).toEqual([edgeRecord]);
    expect(await store.getEvent("evt_local_01")).toEqual(eventRecord);

    const verification = await store.verify({ tenantId });
    expect(verification.ok).toBe(true);
    expect(verification.audit).toEqual({ ok: true });
    expect(verification.edges).toEqual({ ok: true });

    const graph = await store.getEvidenceGraph({ tenantId, rootId: "evt_local_01" });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["evt_local_01", "usr_123"]);
    expect(graph.edges).toEqual([
      {
        id: "edge_local_01",
        from: "usr_123",
        to: "evt_local_01",
        relation: "created",
        source: "edge_record",
        recordHash: edgeRecord.hash,
      },
    ]);

    const bundle = await store.previewExportBundle({ tenantId });
    expect(bundle.manifest.recordCounts).toEqual({ events: 1, edges: 1 });
    expect(bundle.manifest.verification.ok).toBe(true);
    expect(bundle.eventsJsonl).toContain("\"id\":\"evt_local_01\"");
    expect(bundle.edgesJsonl).toContain("\"id\":\"edge_local_01\"");
    expect(bundle.redactionManifest.rules).toContain("metadata keys matching password|secret|token|api[_-]?key|authorization|email|phone|ssn are replaced with [redacted]");

    await store.reset();
    expect(await store.listEvents({ tenantId })).toEqual([]);
    expect(await store.listEdges({ tenantId })).toEqual([]);
  });

  test("runs the local integration scenario from agent session to runtime audit event", async () => {
    const store = new LocalEvidenceStore();

    const result = await runIntegrationScenario(store, { tenantId });

    expect(result.verification.ok).toBe(true);
    expect(result.graph.nodes.map((node) => node.type)).toContain("agent_session");
    expect(result.graph.nodes.map((node) => node.type)).toContain("runtime_event");
    expect(result.graph.edges.map((edge) => edge.relation)).toEqual(["created", "deployed_as", "observed_in"]);
  });
});

describe("Workbench HTTP app", () => {
  test("serves Workbench UI and local evidence API routes", async () => {
    const store = new LocalEvidenceStore();
    const app = createWorkbenchApp({ store, allowWriteTools: true });

    const home = await app.fetch(new Request("http://veritio.local/"));
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toContain("Veritio Workbench");

    const eventResponse = await app.fetch(
      new Request("http://veritio.local/v1/events", {
        method: "POST",
        body: JSON.stringify(eventInput()),
      }),
    );
    expect(eventResponse.status).toBe(201);

    const edgeResponse = await app.fetch(
      new Request("http://veritio.local/v1/edges", {
        method: "POST",
        body: JSON.stringify(edgeInput()),
      }),
    );
    expect(edgeResponse.status).toBe(201);

    const graphResponse = await app.fetch(new Request(`http://veritio.local/v1/graph?tenantId=${tenantId}`));
    const graph = await json(graphResponse);
    expect((graph.nodes as unknown[]).length).toBeGreaterThanOrEqual(2);

    const verifyResponse = await app.fetch(new Request(`http://veritio.local/v1/verify?tenantId=${tenantId}`));
    expect(await json(verifyResponse)).toMatchObject({ ok: true });

    const exportResponse = await app.fetch(
      new Request("http://veritio.local/v1/exports/preview", {
        method: "POST",
        body: JSON.stringify({ tenantId }),
      }),
    );
    expect((await json(exportResponse)).manifest).toMatchObject({ recordCounts: { events: 1, edges: 1 } });
  });
});

describe("MCP JSON-RPC handler", () => {
  test("lists read tools by default and hides write tools", async () => {
    const store = new LocalEvidenceStore();

    const response = await handleMcpRequest(store, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 });
    const toolNames = response.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain("veritio.list_events");
    expect(toolNames).toContain("veritio.preview_export_bundle");
    expect(toolNames).not.toContain("veritio.record_event");
  });

  test("allows write tools only when explicitly enabled", async () => {
    const store = new LocalEvidenceStore();
    const blocked = await handleMcpRequest(store, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "veritio.record_event", arguments: eventInput() },
    });
    expect(blocked.error.message).toBe("MCP write tools are disabled");

    const written = await handleMcpRequest(
      store,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "veritio.record_event", arguments: eventInput() },
      },
      { allowWriteTools: true },
    );
    expect(written.result.record.event.id).toBe("evt_local_01");

    const listed = await handleMcpRequest(store, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "veritio.list_events", arguments: { tenantId } },
    });
    expect(listed.result.records).toHaveLength(1);
  });
});
