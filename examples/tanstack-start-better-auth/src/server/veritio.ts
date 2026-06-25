import { createAuditRecorder, MemoryAuditStore, type AuditRecorder } from "@veritio/core";

/**
 * Server-owned reference identity for the example's Better Auth wiring. The
 * governed-change surfaces use the dedicated engine in `governed-entries.ts`;
 * this module only supplies what Better Auth's user-lifecycle hooks need.
 * Production apps must replace this with a real Better Auth session plus
 * organization/tenant lookup — tenant identity is resolved on the server and
 * never read from browser input.
 */
export interface ReferenceSession {
  tenantId: string;
  actorUserId: string;
}

const referenceSession: ReferenceSession = Object.freeze({
  tenantId: "tenant_demo",
  actorUserId: "user_demo",
});

/**
 * Reuses one in-memory audit store across Vite dev reloads so Better Auth's
 * user-created events remain inspectable during local testing.
 */
function getReferenceAuditStore(): MemoryAuditStore {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioTanStackBetterAuthAuditStore?: MemoryAuditStore;
  };
  referenceGlobal.__veritioTanStackBetterAuthAuditStore ??= new MemoryAuditStore();
  return referenceGlobal.__veritioTanStackBetterAuthAuditStore;
}

/**
 * The recorder Better Auth database hooks use to emit user-lifecycle audit
 * events at the server boundary.
 */
export const auditRecorder: AuditRecorder = createAuditRecorder({ store: getReferenceAuditStore() });

/**
 * Resolves the server-owned reference session. Tenant and actor never originate
 * from browser-supplied input.
 */
export async function resolveReferenceSession(_context?: unknown): Promise<ReferenceSession> {
  return { ...referenceSession };
}
