import type { AuditEvent, EvidenceEdge } from "@veritio/core";

/**
 * Best-effort POST of an invocation's redacted events + edges to a Veritio ingest
 * endpoint. The server re-redacts and re-chains, and ingest is idempotent
 * (deterministic record ids), so a retry or a re-posted session-start is safe.
 * The scoped key is supplied by the caller (resolved at the process boundary);
 * it is never embedded here.
 */
export async function postToIngest(
  ingest: { url: string; key: string },
  payload: { events: AuditEvent[]; edges: EvidenceEdge[] },
): Promise<void> {
  if (payload.events.length === 0 && payload.edges.length === 0) {
    return;
  }
  const response = await fetch(ingest.url, {
    method: "POST",
    headers: { authorization: `Bearer ${ingest.key}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`ingest POST failed with status ${response.status}`);
  }
}
