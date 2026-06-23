import { createFileRoute } from "@tanstack/react-router";
import type { AuditRecord, EvidenceEdgeRecord, VerificationResult } from "@veritio/core";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

interface EvidenceSnapshot {
  records: AuditRecord[];
  edgeRecords: EvidenceEdgeRecord[];
  auditVerification: VerificationResult;
  edgeVerification: VerificationResult;
}

/**
 * Renders the TanStack Start reference UI for governed CRUD. The browser calls
 * CRUD routes and an evidence reader, while tenant and actor identity stay
 * server-owned inside the route handlers.
 */
function Home() {
  const [status, setStatus] = useState("idle");
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [edgeRecords, setEdgeRecords] = useState<EvidenceEdgeRecord[]>([]);
  const [verification, setVerification] = useState("not checked");

  /**
   * Runs create, update, and delete over the example API surface before reading
   * the composed Veritio evidence trail.
   */
  async function runGovernedCrud() {
    setStatus("running CRUD");
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
        setStatus(`${method} failed`);
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
    setStatus("running lifecycle");
    const response = await fetch("/api/scenarios/governed-lifecycle", { method: "POST" });
    if (!response.ok) {
      setStatus("lifecycle failed");
      return;
    }
    await loadEvidenceTrail();
  }

  /**
   * Calls the server-owned evidence endpoint and renders both independently
   * verified chains.
   */
  async function loadEvidenceTrail() {
    setStatus("loading");
    const response = await fetch("/api/evidence");
    if (!response.ok) {
      setStatus("load failed");
      return;
    }
    const body = (await response.json()) as EvidenceSnapshot;
    setRecords(body.records);
    setEdgeRecords(body.edgeRecords);
    setVerification(
      `audit ${body.auditVerification.ok ? "valid" : body.auditVerification.reason}, graph ${
        body.edgeVerification.ok ? "valid" : body.edgeVerification.reason
      }`,
    );
    setStatus(`loaded ${body.records.length} event(s), ${body.edgeRecords.length} edge(s)`);
  }

  return (
    <main>
      <h1>Veritio Governed CRUD</h1>
      <p>
        Recording happens only on the server. The buttons call server route handlers; tenant and actor identity are
        resolved server-side.
      </p>
      <button type="button" onClick={runGovernedCrud}>
        Run governed CRUD
      </button>
      <button type="button" onClick={runGovernedLifecycle}>
        Run lifecycle graph
      </button>
      <button type="button" onClick={loadEvidenceTrail}>
        Load evidence
      </button>
      <p>{status}</p>
      <p>{verification}</p>
      <h2>Audit events</h2>
      <ul>
        {records.map((record) => (
          <li key={record.hash}>
            {record.event.action} → {record.event.target.type}:{record.event.target.id}
          </li>
        ))}
      </ul>
      <h2>Activity graph</h2>
      <ul>
        {edgeRecords.map((record) => (
          <li key={record.hash}>
            {record.edge.from.id} {record.edge.relation} {record.edge.to.resourceType}:{record.edge.to.id}
          </li>
        ))}
      </ul>
    </main>
  );
}
