import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute()({
  component: Home,
});

/**
 * Renders the reference audit-trail loader for the TanStack Start example.
 */
function Home() {
  const [status, setStatus] = useState("idle");

  /**
   * Calls the server-owned audit endpoint without sending tenant identity from
   * the browser.
   */
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
