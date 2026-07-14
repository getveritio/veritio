import type { AuditEvent, EvidenceEdge } from "@veritio/core";

/**
 * Default bound on one ingest ship-out attempt. Mirrors `@veritio/claude-code`:
 * an unbounded await froze the capturing agent for minutes when the hosted
 * endpoint stalled. Aborting is safe server-side now that veritio-cloud enforces
 * fail-closed connection/statement timeouts on every tenant DB connection
 * (issue #32 / PR #33) — the old "never client-abort" rule is obsolete.
 */
export const DEFAULT_INGEST_TIMEOUT_MS = 10_000;

/**
 * Best-effort POST of a turn's redacted events + edges to a Veritio ingest
 * endpoint, aborted after `timeoutMs` (default {@link DEFAULT_INGEST_TIMEOUT_MS})
 * so a stalled endpoint can never block the notify hook past the bound. The
 * server re-redacts and re-chains, and ingest is idempotent (deterministic
 * record ids), so a re-delivered notification is safe to replay.
 */
export async function postToIngest(
  ingest: { url: string; key: string; timeoutMs?: number },
  payload: { events: AuditEvent[]; edges: EvidenceEdge[] },
): Promise<void> {
  if (payload.events.length === 0 && payload.edges.length === 0) {
    return;
  }
  const response = await fetch(ingest.url, {
    method: "POST",
    headers: { authorization: `Bearer ${ingest.key}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ingest.timeoutMs ?? DEFAULT_INGEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`ingest POST failed with status ${response.status}`);
  }
}
