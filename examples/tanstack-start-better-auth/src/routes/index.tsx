import { createFileRoute } from "@tanstack/react-router";
import type { AuditRecord } from "@veritio/core";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

/**
 * Renders the reference UI: a button that records a profile-update event through
 * the server-owned route handler, and a loader that reads the tenant-scoped audit
 * trail. The browser never sends tenant or actor identity; it only supplies the
 * demo profile id.
 */
function Home() {
  const [status, setStatus] = useState("idle");
  const [records, setRecords] = useState<AuditRecord[]>([]);

  /**
   * Records a profile-update event, then refreshes the audit trail so the new
   * entry is visible without sending tenant identity from the browser.
   */
  async function recordProfileUpdate() {
    setStatus("recording");
    const response = await fetch("/api/profile-updates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: "profile_demo" }),
    });
    if (!response.ok) {
      setStatus("record failed");
      return;
    }
    await loadAuditTrail();
  }

  /**
   * Calls the server-owned audit endpoint and renders the returned records.
   */
  async function loadAuditTrail() {
    setStatus("loading");
    const response = await fetch("/api/audit");
    if (!response.ok) {
      setStatus("load failed");
      return;
    }
    const body = (await response.json()) as { records: AuditRecord[] };
    setRecords(body.records);
    setStatus(`loaded ${body.records.length} record(s)`);
  }

  return (
    <main>
      <h1>Veritio Audit Trail</h1>
      <p>
        Recording happens only on the server. The button calls a server route handler; tenant and actor identity are
        resolved server-side.
      </p>
      <button type="button" onClick={recordProfileUpdate}>
        Record profile update
      </button>
      <button type="button" onClick={loadAuditTrail}>
        Load audit trail
      </button>
      <p>{status}</p>
      <ul>
        {records.map((record) => (
          <li key={record.hash}>
            {record.event.action} → {record.event.target.type}:{record.event.target.id}
          </li>
        ))}
      </ul>
    </main>
  );
}
