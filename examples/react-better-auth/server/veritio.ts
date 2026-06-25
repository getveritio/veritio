import { MemoryAuditStore, createAuditRecorder, type AuditRecorder } from "@veritio/core";

/**
 * Reference Veritio boundary for the Better Auth wiring. The governed-change
 * flow owns its own evidence pipeline in `governed-entries.ts`; this module only
 * provides what the Better Auth user-created hook still needs: an audit recorder
 * and a server-resolved reference session. Tenant identity stays server-owned
 * and is never read from browser input.
 */

const auditStore = new MemoryAuditStore();

/** The in-memory audit recorder the Better Auth adapter records user events into. */
export const auditRecorder: AuditRecorder = createAuditRecorder({
  store: auditStore,
});

export interface ReferenceSession {
  tenantId: string;
  actorUserId: string;
}

/**
 * Reference-only server boundary. Replace this with Better Auth session and
 * organization membership lookup; never trust browser-supplied tenant ids.
 */
export async function resolveReferenceSession(_request: unknown): Promise<ReferenceSession> {
  return {
    tenantId: "tenant_demo",
    actorUserId: "user_demo",
  };
}
