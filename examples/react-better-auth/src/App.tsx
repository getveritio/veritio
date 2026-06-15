import type { AuditRecord } from "@veritio/core";
import { useState } from "react";

/**
 * Renders the reference UI for the React Better Auth example: record a profile
 * update through the server recorder, then read back the tenant-scoped trail.
 * The browser never sends tenant or actor identity; the server resolves it.
 */
export function App() {
  const [status, setStatus] = useState("idle");
  const [records, setRecords] = useState<AuditRecord[]>([]);

  /**
   * Records a profile-update event via the server, then refreshes the trail so
   * the new entry is visible.
   */
  async function recordProfileUpdate() {
    setStatus("recording");
    const response = await fetch("/api/profile-updates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: "profile_demo", requestId: `ref_${Date.now()}` }),
    });
    if (!response.ok) {
      setStatus("record failed");
      return;
    }
    await loadAuditTrail();
  }

  /**
   * Calls the server-owned audit endpoint and renders the returned records
   * without sending tenant identity from the browser.
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
      <p>Recording happens only on the Express server; the browser calls same-origin API routes.</p>
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
