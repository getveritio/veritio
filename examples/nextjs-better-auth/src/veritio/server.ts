import "server-only";

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

export async function resolveReferenceSession(): Promise<ReferenceSession> {
  // Replace this stub with Better Auth session and organization membership lookup.
  return {
    tenantId: "tenant_demo",
    actorUserId: "user_demo",
  };
}

export async function listAuditTrailForTenant(input: {
  tenantId: string;
  limit?: number;
}): Promise<AuditRecord[]> {
  return auditStore.list({ tenantId: input.tenantId }, { limit: input.limit ?? 50 });
}
