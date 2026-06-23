import type { AuditRecord, EvidenceEdgeRecord, VerificationResult } from "@veritio/core";
import { useState } from "react";

interface EvidenceSnapshot {
  records: AuditRecord[];
  edgeRecords: EvidenceEdgeRecord[];
  auditVerification: VerificationResult;
  edgeVerification: VerificationResult;
}

/**
 * Renders the React Better Auth reference UI. The browser triggers CRUD calls
 * and reads evidence, while tenant and actor identity remain on the Express
 * server boundary.
 */
export function App() {
  const [status, setStatus] = useState("idle");
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [edgeRecords, setEdgeRecords] = useState<EvidenceEdgeRecord[]>([]);
  const [verification, setVerification] = useState("not checked");

  /**
   * Runs create, update, and delete calls through the same API surface a real
   * CRUD app would expose, then refreshes the composed evidence trail.
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
   * Calls the server-owned evidence endpoint and renders audit and graph chains
   * without sending tenant identity from the browser.
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
      <p>CRUD recording happens only on the Express server; the browser calls same-origin API routes.</p>
      <button type="button" onClick={runGovernedCrud}>
        Run governed CRUD
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
