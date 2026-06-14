import "server-only";

import { createNextVeritioAdapter, type NextVeritioContext } from "@veritio/next";
import {
  MemoryAuditStore,
  createAuditRecorder,
  verifyAuditRecords,
  type AuditRecorder,
  type AuditRecord,
  type VerificationResult,
} from "@veritio/core";

const auditStore = getReferenceAuditStore();
const referenceSession = Object.freeze({
  tenantId: "tenant_demo",
  actorUserId: "user_demo",
});

export const auditRecorder: AuditRecorder = createAuditRecorder({
  store: auditStore,
});

export const nextAudit = createNextVeritioAdapter({
  recorder: auditRecorder,
  environment: "reference",
  async resolveContext() {
    return referenceSessionToNextContext(await resolveReferenceSession());
  },
});

export interface ReferenceSession {
  tenantId: string;
  actorUserId: string;
}

export interface ReferenceAuditTrail {
  session: ReferenceSession;
  records: AuditRecord[];
  verification: VerificationResult;
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
 * Converts a server-resolved reference session into the Next adapter context
 * expected by the Veritio audit recorder.
 */
export function referenceSessionToNextContext(
  session: ReferenceSession,
  requestId?: string,
): NextVeritioContext {
  const context: NextVeritioContext = {
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
export async function listAuditTrailForTenant(input: {
  tenantId: string;
  limit?: number;
}): Promise<AuditRecord[]> {
  return auditStore.list({ tenantId: input.tenantId }, { limit: input.limit ?? 50 });
}

/**
 * Returns the example session, tenant-scoped records, and verification status for
 * the reference UI.
 */
export async function getReferenceAuditTrail(limit = 50): Promise<ReferenceAuditTrail> {
  const session = await resolveReferenceSession();
  const records = await listAuditTrailForTenant({ tenantId: session.tenantId, limit });
  return {
    session,
    records,
    verification: verifyAuditRecords(records),
  };
}

/**
 * Reuses one MemoryAuditStore across Next dev reloads so the reference audit
 * trail remains visible during local testing.
 */
function getReferenceAuditStore(): MemoryAuditStore {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioNextBetterAuthAuditStore?: MemoryAuditStore;
  };
  referenceGlobal.__veritioNextBetterAuthAuditStore ??= new MemoryAuditStore();
  return referenceGlobal.__veritioNextBetterAuthAuditStore;
}
