import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  HASH_ALGORITHM,
  canonicalJson,
  createAuditEvent,
  createEvidenceEdge,
  hashAuditRecord,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  verifyAuditRecords,
  verifyEvidenceEdgeRecords,
  type AuditEvent,
  type AuditEventInput,
  type AuditRecord,
  type AuditStoreAppendOptions,
  type EvidenceEdge,
  type EvidenceEdgeInput,
  type EvidenceEdgeRecord,
  type EvidenceEntity,
  type EvidenceScope,
  type VerificationResult,
} from "@veritio/core";

export interface LocalEvidenceStoreListOptions {
  afterSequence?: number;
  limit?: number;
}

export interface EvidenceGraphQuery {
  tenantId: string;
  rootId?: string;
  limit?: number;
}

export interface EvidenceGraphNode {
  id: string;
  type: string;
  label?: string;
}

export interface EvidenceGraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  source: "edge_record";
  recordHash: string;
}

export interface EvidenceGraph {
  tenantId: string;
  rootId?: string;
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
}

export interface VerificationReport {
  ok: boolean;
  audit: VerificationResult;
  edges: VerificationResult;
}

export interface ExportBundlePreview {
  manifest: {
    schemaVersion: "2026-06-14";
    tenantId: string;
    createdAt: string;
    canonicalization: "veritio-json-v1";
    hashAlgorithm: typeof HASH_ALGORITHM;
    recordCounts: { events: number; edges: number };
    verification: VerificationReport;
    files: Array<{ name: string; sha256: string }>;
  };
  eventsJsonl: string;
  edgesJsonl: string;
  verificationReport: VerificationReport;
  redactionManifest: {
    rules: string[];
  };
}

export interface WorkbenchAppOptions {
  store?: LocalEvidenceStore;
  allowWriteTools?: boolean;
}

export interface WorkbenchApp {
  store: LocalEvidenceStore;
  fetch(request: Request): Promise<Response>;
}

export interface StartWorkbenchServerOptions extends WorkbenchAppOptions {
  host?: string;
  port?: number;
}

export interface StartedWorkbenchServer {
  app: WorkbenchApp;
  server: Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface McpRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpHandlerOptions {
  allowWriteTools?: boolean;
}

const REDACTION_RULE =
  "metadata keys matching password|secret|token|api[_-]?key|authorization|email|phone|ssn are replaced with [redacted]";

const READ_TOOLS = [
  "veritio.list_events",
  "veritio.get_event",
  "veritio.list_edges",
  "veritio.get_evidence_graph",
  "veritio.verify_chain",
  "veritio.preview_export_bundle",
  "veritio.run_integration_scenario",
] as const;

const WRITE_TOOLS = [
  "veritio.record_event",
  "veritio.record_edge",
  "veritio.reset_dev_store",
  "veritio.create_export_bundle",
] as const;

export class LocalEvidenceStore {
  #auditRecords: AuditRecord[] = [];
  #edgeRecords: EvidenceEdgeRecord[] = [];
  #auditIdempotency = new Map<string, { canonical: string; record: AuditRecord }>();
  #edgeIdempotency = new Map<string, { canonical: string; record: EvidenceEdgeRecord }>();
  #auditTips = new Map<string, AuditRecord>();
  #edgeTips = new Map<string, EvidenceEdgeRecord>();

  async recordEvent(input: AuditEventInput | AuditEvent, options: AuditStoreAppendOptions = {}): Promise<AuditRecord> {
    const event = isAuditEvent(input) ? clone(input) : createAuditEvent(input);
    const tenantId = requireTenantId(event.scope, "scope.tenantId");
    const idempotencyKeyHash = hashIdempotencyKey(tenantId, options.idempotencyKey ?? event.id);
    const canonical = canonicalJson(event);
    const existing = this.#auditIdempotency.get(idempotencyKeyHash);
    if (existing) {
      if (existing.canonical !== canonical) {
        throw new TypeError("idempotency conflict");
      }
      return clone(existing.record);
    }

    const tip = this.#auditTips.get(tenantId);
    const previousHash = tip?.hash ?? null;
    if (options.expectedPreviousHash !== undefined && options.expectedPreviousHash !== previousHash) {
      throw new TypeError("expectedPreviousHash does not match tenant chain tip");
    }

    const recordWithoutHash: Omit<AuditRecord, "hash"> = {
      event: clone(event),
      sequence: (tip?.sequence ?? 0) + 1,
      previousHash,
      hashAlgorithm: HASH_ALGORITHM,
      canonicalization: "veritio-json-v1",
      appendedAt: new Date().toISOString(),
      idempotencyKeyHash,
    };
    const record: AuditRecord = { ...recordWithoutHash, hash: hashAuditRecord(recordWithoutHash) };

    this.#auditRecords.push(record);
    this.#auditTips.set(tenantId, record);
    this.#auditIdempotency.set(idempotencyKeyHash, { canonical, record });
    return clone(record);
  }

  async recordEdge(input: EvidenceEdgeInput | EvidenceEdge, options: AuditStoreAppendOptions = {}): Promise<EvidenceEdgeRecord> {
    const edge = isEvidenceEdge(input) ? clone(input) : createEvidenceEdge(input);
    const tenantId = requireTenantId(edge.scope, "scope.tenantId");
    const idempotencyKeyHash = hashIdempotencyKey(tenantId, options.idempotencyKey ?? edge.id);
    const canonical = canonicalJson(edge);
    const existing = this.#edgeIdempotency.get(idempotencyKeyHash);
    if (existing) {
      if (existing.canonical !== canonical) {
        throw new TypeError("idempotency conflict");
      }
      return clone(existing.record);
    }

    const tip = this.#edgeTips.get(tenantId);
    const previousHash = tip?.hash ?? null;
    if (options.expectedPreviousHash !== undefined && options.expectedPreviousHash !== previousHash) {
      throw new TypeError("expectedPreviousHash does not match tenant edge chain tip");
    }

    const recordWithoutHash: Omit<EvidenceEdgeRecord, "hash"> = {
      edge: clone(edge),
      sequence: (tip?.sequence ?? 0) + 1,
      previousHash,
      hashAlgorithm: HASH_ALGORITHM,
      canonicalization: "veritio-json-v1",
      appendedAt: new Date().toISOString(),
      idempotencyKeyHash,
    };
    const record: EvidenceEdgeRecord = { ...recordWithoutHash, hash: hashEvidenceEdgeRecord(recordWithoutHash) };

    this.#edgeRecords.push(record);
    this.#edgeTips.set(tenantId, record);
    this.#edgeIdempotency.set(idempotencyKeyHash, { canonical, record });
    return clone(record);
  }

  async listEvents(scope: EvidenceScope & { tenantId: string }, options: LocalEvidenceStoreListOptions = {}): Promise<AuditRecord[]> {
    const tenantId = requireTenantId(scope, "scope.tenantId");
    validateListOptions(options);
    const records = this.#auditRecords.filter((record) => {
      return record.event.scope?.tenantId === tenantId && record.sequence > (options.afterSequence ?? 0);
    });
    return limited(records, options.limit).map(clone);
  }

  async listEdges(scope: EvidenceScope & { tenantId: string }, options: LocalEvidenceStoreListOptions = {}): Promise<EvidenceEdgeRecord[]> {
    const tenantId = requireTenantId(scope, "scope.tenantId");
    validateListOptions(options);
    const records = this.#edgeRecords.filter((record) => {
      return record.edge.scope?.tenantId === tenantId && record.sequence > (options.afterSequence ?? 0);
    });
    return limited(records, options.limit).map(clone);
  }

  async getEvent(id: string): Promise<AuditRecord | null> {
    const record = this.#auditRecords.find((candidate) => candidate.event.id === id);
    return record ? clone(record) : null;
  }

  async getEdge(id: string): Promise<EvidenceEdgeRecord | null> {
    const record = this.#edgeRecords.find((candidate) => candidate.edge.id === id);
    return record ? clone(record) : null;
  }

  async verify(scope: EvidenceScope & { tenantId: string }): Promise<VerificationReport> {
    const tenantId = requireTenantId(scope, "scope.tenantId");
    const audit = verifyAuditRecords(await this.listEvents({ tenantId }));
    const edges = verifyEvidenceEdgeRecords(await this.listEdges({ tenantId }));
    return { ok: audit.ok && edges.ok, audit, edges };
  }

  async getEvidenceGraph(query: EvidenceGraphQuery): Promise<EvidenceGraph> {
    const tenantId = requireTenantId({ tenantId: query.tenantId }, "tenantId");
    const listOptions: LocalEvidenceStoreListOptions = {};
    if (query.limit !== undefined) {
      listOptions.limit = query.limit;
    }
    const records = await this.listEdges({ tenantId }, listOptions);
    const edges = records
      .filter((record) => !query.rootId || record.edge.from.id === query.rootId || record.edge.to.id === query.rootId)
      .map((record) => edgeRecordToGraphEdge(record));
    const nodes = new Map<string, EvidenceGraphNode>();
    for (const record of records) {
      if (query.rootId && record.edge.from.id !== query.rootId && record.edge.to.id !== query.rootId) {
        continue;
      }
      addGraphNode(nodes, record.edge.from);
      addGraphNode(nodes, record.edge.to);
    }

    const graph: EvidenceGraph = { tenantId, nodes: [...nodes.values()].sort(compareNodes), edges };
    if (query.rootId) {
      graph.rootId = query.rootId;
    }
    return graph;
  }

  async previewExportBundle(scope: EvidenceScope & { tenantId: string }): Promise<ExportBundlePreview> {
    const tenantId = requireTenantId(scope, "scope.tenantId");
    const events = await this.listEvents({ tenantId });
    const edges = await this.listEdges({ tenantId });
    const verification = await this.verify({ tenantId });
    const eventsJsonl = toJsonl(events);
    const edgesJsonl = toJsonl(edges);
    const verificationJson = canonicalJson(verification);
    const redactionManifest = { rules: [REDACTION_RULE] };
    const redactionJson = canonicalJson(redactionManifest);

    return {
      manifest: {
        schemaVersion: "2026-06-14",
        tenantId,
        createdAt: new Date().toISOString(),
        canonicalization: "veritio-json-v1",
        hashAlgorithm: HASH_ALGORITHM,
        recordCounts: { events: events.length, edges: edges.length },
        verification,
        files: [
          { name: "events.jsonl", sha256: sha256Hex(eventsJsonl) },
          { name: "edges.jsonl", sha256: sha256Hex(edgesJsonl) },
          { name: "verification.json", sha256: sha256Hex(verificationJson) },
          { name: "redaction-manifest.json", sha256: sha256Hex(redactionJson) },
        ],
      },
      eventsJsonl,
      edgesJsonl,
      verificationReport: verification,
      redactionManifest,
    };
  }

  async reset(): Promise<void> {
    this.#auditRecords = [];
    this.#edgeRecords = [];
    this.#auditIdempotency.clear();
    this.#edgeIdempotency.clear();
    this.#auditTips.clear();
    this.#edgeTips.clear();
  }
}

export async function runIntegrationScenario(
  store: LocalEvidenceStore,
  options: { tenantId?: string } = {},
): Promise<{ tenantId: string; graph: EvidenceGraph; verification: VerificationReport; exportPreview: ExportBundlePreview }> {
  const tenantId = options.tenantId ?? "tenant_local_demo";
  await store.recordEvent({
    id: "evt_agent_session_started",
    occurredAt: "2026-06-14T00:00:00.000Z",
    actor: { type: "ai_agent", id: "agent_opencode" },
    action: "agent.session.started",
    target: { type: "agent_session", id: "agt_sess_local_demo" },
    scope: { tenantId, environment: "dev" },
    purpose: "change_provenance",
    dataCategories: ["source_reference"],
    retention: "change_1y",
    metadata: { model: "local-fixture", promptHash: "sha256:prompt_fixture" },
  });
  await store.recordEvent({
    id: "evt_runtime_member_invited",
    occurredAt: "2026-06-14T00:00:03.000Z",
    actor: { type: "user", id: "usr_reviewer" },
    action: "org.member.invited",
    target: { type: "organization", id: tenantId },
    scope: { tenantId, environment: "dev" },
    purpose: "access_management",
    dataCategories: ["account"],
    retention: "security_1y",
    metadata: { role: "viewer" },
  });
  await store.recordEdge({
    id: "edge_agent_created_file",
    occurredAt: "2026-06-14T00:00:01.000Z",
    scope: { tenantId, environment: "dev" },
    from: { type: "agent_session", id: "agt_sess_local_demo" },
    relation: "created",
    to: { type: "file", id: "file_invite_route", pathHash: "sha256:file_invite_route" },
    metadata: { reason: "ai_agent" },
  });
  await store.recordEdge({
    id: "edge_file_deployed",
    occurredAt: "2026-06-14T00:00:02.000Z",
    scope: { tenantId, environment: "dev" },
    from: { type: "file", id: "file_invite_route", pathHash: "sha256:file_invite_route" },
    relation: "deployed_as",
    to: { type: "deployment", id: "dep_local_demo" },
    metadata: { artifactHash: "sha256:artifact_fixture" },
  });
  await store.recordEdge({
    id: "edge_deploy_observed_runtime",
    occurredAt: "2026-06-14T00:00:03.000Z",
    scope: { tenantId, environment: "dev" },
    from: { type: "deployment", id: "dep_local_demo" },
    relation: "observed_in",
    to: { type: "runtime_event", id: "evt_runtime_member_invited" },
    metadata: { route: "/api/invitations" },
  });

  return {
    tenantId,
    graph: await store.getEvidenceGraph({ tenantId }),
    verification: await store.verify({ tenantId }),
    exportPreview: await store.previewExportBundle({ tenantId }),
  };
}

export function createWorkbenchApp(options: WorkbenchAppOptions = {}): WorkbenchApp {
  const store = options.store ?? new LocalEvidenceStore();
  return {
    store,
    async fetch(request) {
      return handleWorkbenchRequest(store, request, { allowWriteTools: options.allowWriteTools ?? false });
    },
  };
}

export async function startWorkbenchServer(options: StartWorkbenchServerOptions = {}): Promise<StartedWorkbenchServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4983;
  const app = createWorkbenchApp(options);
  const server = createServer((request, response) => {
    void handleNodeRequest(app, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  return {
    app,
    server,
    host,
    port,
    url: `http://${host}:${port}`,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function handleMcpRequest(
  store: LocalEvidenceStore,
  request: McpRequest,
  options: McpHandlerOptions = {},
): Promise<Record<string, any>> {
  const id = request.id ?? null;
  if (request.method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "veritio-local", version: "0.0.0" },
      capabilities: { tools: {} },
    });
  }
  if (request.method === "tools/list") {
    const tools = [...READ_TOOLS, ...(options.allowWriteTools ? WRITE_TOOLS : [])].map((name) => {
      return { name, description: toolDescription(name), inputSchema: { type: "object" } };
    });
    return rpcResult(id, { tools });
  }
  if (request.method !== "tools/call") {
    return rpcError(id, -32601, "Unsupported MCP method");
  }

  const params = request.params ?? {};
  const name = String(params.name ?? "");
  const args = isObject(params.arguments) ? params.arguments : {};
  if ((WRITE_TOOLS as readonly string[]).includes(name) && !options.allowWriteTools) {
    return rpcError(id, -32001, "MCP write tools are disabled");
  }

  try {
    switch (name) {
      case "veritio.list_events":
        return rpcResult(id, { records: await store.listEvents({ tenantId: requireTenantArg(args) }, listOptions(args)) });
      case "veritio.get_event":
        return rpcResult(id, { record: await store.getEvent(requireString(args.id, "id")) });
      case "veritio.list_edges":
        return rpcResult(id, { records: await store.listEdges({ tenantId: requireTenantArg(args) }, listOptions(args)) });
      case "veritio.get_evidence_graph":
        return rpcResult(id, { graph: await store.getEvidenceGraph(graphQuery(args)) });
      case "veritio.verify_chain":
        return rpcResult(id, await store.verify({ tenantId: requireTenantArg(args) }));
      case "veritio.preview_export_bundle":
        return rpcResult(id, await store.previewExportBundle({ tenantId: requireTenantArg(args) }));
      case "veritio.run_integration_scenario":
        return rpcResult(id, await runIntegrationScenario(store, scenarioOptions(optionalString(args.tenantId))));
      case "veritio.record_event":
        return rpcResult(id, { record: await store.recordEvent(args as unknown as AuditEventInput) });
      case "veritio.record_edge":
        return rpcResult(id, { record: await store.recordEdge(args as unknown as EvidenceEdgeInput) });
      case "veritio.reset_dev_store":
        await store.reset();
        return rpcResult(id, { ok: true });
      case "veritio.create_export_bundle":
        return rpcResult(id, await store.previewExportBundle({ tenantId: requireTenantArg(args) }));
      default:
        return rpcError(id, -32602, `Unknown MCP tool: ${name}`);
    }
  } catch (error) {
    return rpcError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

async function handleWorkbenchRequest(
  store: LocalEvidenceStore,
  request: Request,
  options: McpHandlerOptions,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/") {
      return htmlResponse(renderWorkbenchHtml());
    }
    if (url.pathname === "/v1/events") {
      if (request.method === "GET") {
        return jsonResponse({ records: await store.listEvents({ tenantId: requireTenantParam(url) }, listOptionsFromUrl(url)) });
      }
      if (request.method === "POST") {
        return jsonResponse({ record: await store.recordEvent((await request.json()) as AuditEventInput) }, 201);
      }
    }
    if (url.pathname === "/v1/edges") {
      if (request.method === "GET") {
        return jsonResponse({ records: await store.listEdges({ tenantId: requireTenantParam(url) }, listOptionsFromUrl(url)) });
      }
      if (request.method === "POST") {
        return jsonResponse({ record: await store.recordEdge((await request.json()) as EvidenceEdgeInput) }, 201);
      }
    }
    if (request.method === "GET" && url.pathname === "/v1/graph") {
      return jsonResponse(await store.getEvidenceGraph(graphQueryFromUrl(url)));
    }
    if (request.method === "GET" && url.pathname === "/v1/verify") {
      return jsonResponse(await store.verify({ tenantId: requireTenantParam(url) }));
    }
    if (request.method === "POST" && url.pathname === "/v1/exports/preview") {
      const body = (await request.json()) as Record<string, unknown>;
      return jsonResponse(await store.previewExportBundle({ tenantId: requireTenantArg(body) }));
    }
    if (request.method === "POST" && url.pathname === "/v1/scenarios/integration") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return jsonResponse(await runIntegrationScenario(store, scenarioOptions(optionalString(body.tenantId))));
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const body = (await request.json()) as McpRequest;
      return jsonResponse(await handleMcpRequest(store, body, options));
    }
    return jsonResponse({ error: "not_found" }, 404);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

function renderWorkbenchHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Veritio Workbench</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: #111827; }
    header { padding: 20px 24px; border-bottom: 1px solid #d8dde6; background: #ffffff; }
    main { display: grid; grid-template-columns: minmax(260px, 360px) 1fr; min-height: calc(100vh - 73px); }
    aside { border-right: 1px solid #d8dde6; padding: 16px; background: #ffffff; }
    section { padding: 16px; }
    h1 { margin: 0; font-size: 20px; }
    h2 { font-size: 14px; margin: 0 0 10px; }
    pre { white-space: pre-wrap; background: #101827; color: #f9fafb; padding: 12px; border-radius: 6px; overflow: auto; }
    button { border: 1px solid #9aa4b2; background: #ffffff; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
    .stack { display: grid; gap: 10px; }
  </style>
</head>
<body>
  <header><h1>Veritio Workbench</h1></header>
  <main>
    <aside class="stack">
      <h2>Local Actions</h2>
      <button id="scenario">Run integration scenario</button>
      <button id="refresh">Refresh graph</button>
    </aside>
    <section class="stack">
      <h2>Evidence Graph</h2>
      <pre id="output">{"status":"ready"}</pre>
    </section>
  </main>
  <script>
    const tenantId = "tenant_local_demo";
    const output = document.getElementById("output");
    async function showGraph() {
      const response = await fetch("/v1/graph?tenantId=" + encodeURIComponent(tenantId));
      output.textContent = JSON.stringify(await response.json(), null, 2);
    }
    document.getElementById("scenario").addEventListener("click", async () => {
      const response = await fetch("/v1/scenarios/integration", { method: "POST", body: JSON.stringify({ tenantId }) });
      output.textContent = JSON.stringify(await response.json(), null, 2);
    });
    document.getElementById("refresh").addEventListener("click", showGraph);
  </script>
</body>
</html>`;
}

async function handleNodeRequest(app: WorkbenchApp, incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  try {
    const body = await readIncomingBody(incoming);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(", "));
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }
    const requestInit: RequestInit = {
      method: incoming.method ?? "GET",
      headers,
    };
    if (body.length > 0 && incoming.method !== "GET" && incoming.method !== "HEAD") {
      requestInit.body = new Uint8Array(body);
    }
    const request = new Request(`http://${incoming.headers.host ?? "127.0.0.1"}${incoming.url ?? "/"}`, requestInit);
    const response = await app.fetch(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "application/json; charset=utf-8");
    outgoing.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

function readIncomingBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function isAuditEvent(value: AuditEventInput | AuditEvent): value is AuditEvent {
  return (value as AuditEvent).schemaVersion === "2026-06-10";
}

function isEvidenceEdge(value: EvidenceEdgeInput | EvidenceEdge): value is EvidenceEdge {
  return (value as EvidenceEdge).schemaVersion === "2026-06-13";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireTenantId(scope: EvidenceScope | undefined, field: string): string {
  return requireString(scope?.tenantId, field);
}

function requireTenantParam(url: URL): string {
  return requireString(url.searchParams.get("tenantId"), "tenantId");
}

function requireTenantArg(args: Record<string, unknown>): string {
  return requireString(args.tenantId, "tenantId");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function validateListOptions(options: LocalEvidenceStoreListOptions): void {
  if (options.afterSequence !== undefined && (!Number.isInteger(options.afterSequence) || options.afterSequence < 0)) {
    throw new TypeError("afterSequence must be a non-negative integer");
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new TypeError("limit must be a non-negative integer");
  }
}

function listOptions(value: Record<string, unknown>): LocalEvidenceStoreListOptions {
  const options: LocalEvidenceStoreListOptions = {};
  if (typeof value.afterSequence === "number") {
    options.afterSequence = value.afterSequence;
  }
  if (typeof value.limit === "number") {
    options.limit = value.limit;
  }
  return options;
}

function listOptionsFromUrl(url: URL): LocalEvidenceStoreListOptions {
  const options: LocalEvidenceStoreListOptions = {};
  const afterSequence = url.searchParams.get("afterSequence");
  const limit = url.searchParams.get("limit");
  if (afterSequence !== null) {
    options.afterSequence = Number(afterSequence);
  }
  if (limit !== null) {
    options.limit = Number(limit);
  }
  return options;
}

function graphQuery(value: Record<string, unknown>): EvidenceGraphQuery {
  const query: EvidenceGraphQuery = { tenantId: requireTenantArg(value) };
  const rootId = optionalString(value.rootId);
  const limit = typeof value.limit === "number" ? value.limit : undefined;
  if (rootId) {
    query.rootId = rootId;
  }
  if (limit !== undefined) {
    query.limit = limit;
  }
  return query;
}

function graphQueryFromUrl(url: URL): EvidenceGraphQuery {
  const query: EvidenceGraphQuery = { tenantId: requireTenantParam(url) };
  const rootId = url.searchParams.get("rootId");
  const limit = url.searchParams.get("limit");
  if (rootId) {
    query.rootId = rootId;
  }
  if (limit !== null) {
    query.limit = Number(limit);
  }
  return query;
}

function scenarioOptions(tenantId: string | undefined): { tenantId?: string } {
  return tenantId ? { tenantId } : {};
}

function limited<T>(records: readonly T[], limit: number | undefined): T[] {
  return limit === undefined ? [...records] : records.slice(0, limit);
}

function addGraphNode(nodes: Map<string, EvidenceGraphNode>, entity: EvidenceEntity): void {
  if (!nodes.has(entity.id)) {
    nodes.set(entity.id, { id: entity.id, type: entity.type });
  }
}

function edgeRecordToGraphEdge(record: EvidenceEdgeRecord): EvidenceGraphEdge {
  return {
    id: record.edge.id,
    from: record.edge.from.id,
    to: record.edge.to.id,
    relation: record.edge.relation,
    source: "edge_record",
    recordHash: record.hash,
  };
}

function compareNodes(left: EvidenceGraphNode, right: EvidenceGraphNode): number {
  return left.id.localeCompare(right.id);
}

function toJsonl(records: readonly unknown[]): string {
  return records.map((record) => canonicalJson(record)).join("\n");
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(value: string): Response {
  return new Response(value, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function rpcResult(id: string | number | null, result: unknown): Record<string, any> {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string): Record<string, any> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolDescription(name: string): string {
  switch (name) {
    case "veritio.record_event":
      return "Record a local Veritio audit event when write tools are enabled.";
    case "veritio.record_edge":
      return "Record a local Veritio evidence graph edge when write tools are enabled.";
    case "veritio.reset_dev_store":
      return "Clear the local development evidence store.";
    default:
      return `Read local evidence through ${name}.`;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
