import { type AuditRecord, type AuditRecorder, createAuditRecorder, MemoryAuditStore } from "@veritio/core";
import { createTanStackStartVeritioAdapter, type TanStackStartVeritioContext } from "@veritio/tanstack-start";

const auditStore = getReferenceAuditStore();
const referenceSession = Object.freeze({
  tenantId: "tenant_demo",
  actorUserId: "user_demo",
});

export const auditRecorder: AuditRecorder = createAuditRecorder({
  store: auditStore,
});

export const tanstackAudit = createTanStackStartVeritioAdapter({
  recorder: auditRecorder,
  environment: "reference",
  async resolveContext() {
    return referenceSessionToTanStackContext(await resolveReferenceSession());
  },
});

export interface ReferenceSession {
  tenantId: string;
  actorUserId: string;
}

/**
 * Reference-only server boundary. Replace this with Better Auth session and
 * organization membership lookup; never trust browser-supplied tenant ids.
 */
export async function resolveReferenceSession(_request?: unknown): Promise<ReferenceSession> {
  return { ...referenceSession };
}

/**
 * Converts a server-resolved reference session into the TanStack Start adapter
 * context expected by the Veritio audit recorder. Tenant identity stays
 * server-owned and never originates from the browser.
 */
export function referenceSessionToTanStackContext(
  session: ReferenceSession,
  requestId?: string,
): TanStackStartVeritioContext {
  const context: TanStackStartVeritioContext = {
    tenantId: session.tenantId,
    actor: { type: "user", id: session.actorUserId },
    environment: "reference",
  };
  if (requestId) {
    context.requestId = requestId;
  }
  return context;
}

/**
 * Lists audit records only for the server-resolved tenant in the reference
 * example.
 */
export async function listAuditTrailForTenant(input: { tenantId: string; limit?: number }): Promise<AuditRecord[]> {
  return auditStore.list({ tenantId: input.tenantId }, { limit: input.limit ?? 50 });
}

/**
 * Reuses one MemoryAuditStore across Vite dev reloads so the reference audit
 * trail remains visible during local testing.
 */
function getReferenceAuditStore(): MemoryAuditStore {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioTanStackBetterAuthAuditStore?: MemoryAuditStore;
  };
  referenceGlobal.__veritioTanStackBetterAuthAuditStore ??= new MemoryAuditStore();
  return referenceGlobal.__veritioTanStackBetterAuthAuditStore;
}
