import { useState } from "react";

export function App() {
  const [status, setStatus] = useState("idle");

  async function loadAuditTrail() {
    setStatus("loading");
    const response = await fetch("/api/audit");
    setStatus(response.ok ? "loaded" : "failed");
  }

  return (
    <main>
      <h1>Veritio Audit Trail</h1>
      <button type="button" onClick={loadAuditTrail}>
        Load reference audit trail
      </button>
      <p>{status}</p>
    </main>
  );
}
