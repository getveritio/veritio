<script lang="ts">
import type { AuditRecord, EvidenceEdgeRecord, VerificationResult } from "@veritio/core";

interface EvidenceSnapshot {
  records: AuditRecord[];
  edgeRecords: EvidenceEdgeRecord[];
  auditVerification: VerificationResult;
  edgeVerification: VerificationResult;
}

let status = "idle";
let records: AuditRecord[] = [];
let edgeRecords: EvidenceEdgeRecord[] = [];
let verification = "not checked";

/**
 * Runs create, update, and delete over the SvelteKit API routes while tenant
 * and actor identity remain server-owned.
 */
async function runGovernedCrud() {
  status = "running CRUD";
  const requestId = `ref_${Date.now()}`;
  const calls = [
    ["POST", { projectId: "project_demo", name: "Governed Project", requestId: `${requestId}:create` }],
    ["PUT", { projectId: "project_demo", status: "archived", requestId: `${requestId}:update` }],
    ["DELETE", { projectId: "project_demo", requestId: `${requestId}:delete` }],
  ] as const;
  for (const [method, body] of calls) {
    const response = await fetch("/api/projects", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      status = `${method} failed`;
      return;
    }
  }
  await loadEvidenceTrail();
}

/**
 * Runs the richer lifecycle scenario on the server and reloads both verified
 * chains so the UI can show auth, org, consent, DSAR, export, and retention
 * events wired into one graph.
 */
async function runGovernedLifecycle() {
  status = "running lifecycle";
  const response = await fetch("/api/scenarios/governed-lifecycle", { method: "POST" });
  if (!response.ok) {
    status = "lifecycle failed";
    return;
  }
  await loadEvidenceTrail();
}

/**
 * Calls the server-owned evidence endpoint and renders both verified chains
 * without sending tenant identity from the browser.
 */
async function loadEvidenceTrail() {
  status = "loading";
  const response = await fetch("/api/evidence");
  if (!response.ok) {
    status = "load failed";
    return;
  }
  const body = (await response.json()) as EvidenceSnapshot;
  records = body.records;
  edgeRecords = body.edgeRecords;
  verification = `audit ${body.auditVerification.ok ? "valid" : body.auditVerification.reason}, graph ${
    body.edgeVerification.ok ? "valid" : body.edgeVerification.reason
  }`;
  status = `loaded ${body.records.length} event(s), ${body.edgeRecords.length} edge(s)`;
}
</script>

<main>
  <h1>Veritio Governed CRUD</h1>
  <p>CRUD recording happens only on the SvelteKit server; the browser calls same-origin API routes.</p>
  <button type="button" onclick={runGovernedCrud}>Run governed CRUD</button>
  <button type="button" onclick={runGovernedLifecycle}>Run lifecycle graph</button>
  <button type="button" onclick={loadEvidenceTrail}>Load evidence</button>
  <p>{status}</p>
  <p>{verification}</p>
  <h2>Audit events</h2>
  <ul>
    {#each records as record (record.hash)}
      <li>{record.event.action} → {record.event.target.type}:{record.event.target.id}</li>
    {/each}
  </ul>
  <h2>Activity graph</h2>
  <ul>
    {#each edgeRecords as record (record.hash)}
      <li>{record.edge.from.id} {record.edge.relation} {record.edge.to.resourceType}:{record.edge.to.id}</li>
    {/each}
  </ul>
</main>
