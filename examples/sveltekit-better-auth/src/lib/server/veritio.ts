import { MemoryAuditStore, createAuditRecorder, type AuditRecorder } from "@veritio/core";

/**
 * Server-owned Veritio boundary for the Better Auth side of this example. It
 * exposes the audit recorder used by the Better Auth database-hook adapter
 * (`auth-events.ts`) and the reference-session resolver that supplies
 * server-owned tenant scope. Identity/tenant are resolved here, never trusted
 * from the browser. The governed-change flow has its own boundary in
 * `governed-entries.ts` / `cloud-ingest.ts`.
 */

const auditStore = new MemoryAuditStore();

/** Shared in-memory audit recorder for the Better Auth user-lifecycle events. */
export const auditRecorder: AuditRecorder = createAuditRecorder({
  store: auditStore,
});

/** Server-resolved tenant scope and actor for the reference example. */
export interface ReferenceSession {
  tenantId: string;
  actorUserId: string;
}

/**
 * Reference-only server boundary. Replace this with Better Auth session and
 * organization membership lookup; never trust browser-supplied tenant ids.
 */
export async function resolveReferenceSession(_event: unknown): Promise<ReferenceSession> {
  return {
    tenantId: "tenant_demo",
    actorUserId: "user_demo",
  };
}
