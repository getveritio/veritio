import "server-only";

import { MemoryAuditStore, createAuditRecorder, type AuditRecorder } from "@veritio/core";

/**
 * Better Auth support boundary for the example. The governed-action demo (entry
 * cards → server action → outbox → hosted ingest) lives in `src/server/`; this
 * module exists only so the Better Auth lifecycle hooks have a Veritio recorder
 * and a server-owned session/tenant boundary.
 *
 * Identity is server-owned: real apps replace `resolveReferenceSession` with a
 * Better Auth session plus organization-membership lookup, and replace the
 * in-memory store with durable storage. Never accept `tenantId` or `actorUserId`
 * from form fields, query params, or browser storage.
 */

const auditStore = getReferenceAuditStore();
const referenceSession = Object.freeze({
  tenantId: "tenant_demo",
  actorUserId: "user_demo",
});

/** The recorder Better Auth hooks write user/session lifecycle events into. */
export const auditRecorder: AuditRecorder = createAuditRecorder({
  store: auditStore,
});

export interface ReferenceSession {
  tenantId: string;
  actorUserId: string;
}

/**
 * Reference-only server boundary. Host apps must replace this with a Better Auth
 * session lookup plus tenant or organization membership lookup. Do not accept
 * tenantId or actorUserId from form fields, query params, or browser storage.
 */
export async function resolveReferenceSession(_input?: unknown): Promise<ReferenceSession> {
  return { ...referenceSession };
}

/**
 * Reuses one MemoryAuditStore across Next dev reloads so Better Auth lifecycle
 * events recorded during local testing remain visible to the recorder.
 */
function getReferenceAuditStore(): MemoryAuditStore {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioNextBetterAuthAuditStore?: MemoryAuditStore;
  };
  referenceGlobal.__veritioNextBetterAuthAuditStore ??= new MemoryAuditStore();
  return referenceGlobal.__veritioNextBetterAuthAuditStore;
}
