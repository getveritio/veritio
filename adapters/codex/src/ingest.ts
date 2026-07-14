import type { AuditEvent, EvidenceEdge } from "@veritio/core";

/**
 * Best-effort POST of a turn's redacted events + edges to a Veritio ingest
 * endpoint. The server re-redacts and re-chains, and ingest is idempotent
 * (deterministic record ids), so a re-delivered notification is safe to replay.
 *
 * Deliberately uses NO client-side abort/timeout: an aborted ingest request can
 * leave a hosted DB connection and its transaction alive, wedging that tenant
 * (see veritio-cloud issue #32). Capture must fail by returning, never by
 * cancelling an in-flight request.
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
