import type { AuditEvent, EvidenceEdge } from "@veritio/core";

/**
 * Default bound on one ingest ship-out attempt. An UNBOUNDED await here once
 * froze Claude Code for minutes when the hosted endpoint stalled (SessionStart
 * blocked on Bun's 5-minute fetch default), so every ship-out must abort in
 * bounded time. Aborting is safe server-side: veritio-cloud enforces fail-closed
 * connection/statement timeouts on every tenant DB connection (issue #32 /
 * PR #33), so a client abort can no longer wedge a tenant.
 */
export const DEFAULT_INGEST_TIMEOUT_MS = 10_000;

/**
 * Best-effort POST of an invocation's redacted events + edges to a Veritio ingest
 * endpoint, aborted after `timeoutMs` (default {@link DEFAULT_INGEST_TIMEOUT_MS})
 * so a stalled endpoint can never block the agent past the bound. The server
 * re-redacts and re-chains, and ingest is idempotent (deterministic record ids),
 * so a retry or a re-posted session-start is safe. The scoped key is supplied by
 * the caller (resolved at the process boundary); it is never embedded here.
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
