import {
  MemoryAuditStore,
  createAuditRecorder,
  type AuditRecorder,
  type AuditRecord,
} from "@veritio/core";

const auditStore = new MemoryAuditStore();

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

/**
 * Lists audit records only for the server-resolved tenant in the reference
 * example.
 */
export async function listAuditTrailForTenant(input: {
  tenantId: string;
  limit?: number;
}): Promise<AuditRecord[]> {
  return auditStore.list({ tenantId: input.tenantId }, { limit: input.limit ?? 50 });
}
