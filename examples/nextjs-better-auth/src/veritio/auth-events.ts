import "server-only";

import { createBetterAuthVeritioAdapter } from "@veritio/better-auth";
import { auditRecorder } from "./server";

const veritioAuth = createBetterAuthVeritioAdapter({
  recorder: auditRecorder,
  environment: "reference",
});

/**
 * Records a user-created lifecycle event after Better Auth has persisted the
 * user, using tenant scope resolved by the server boundary.
 */
export async function recordBetterAuthUserCreated(input: {
  userId: string;
  tenantId: string;
  requestId?: string;
}) {
  return veritioAuth.recordUserCreated({
    user: { id: input.userId },
    tenantId: input.tenantId,
    requestId: input.requestId,
  });
}

/**
 * Records a session-created lifecycle event with tenant scope and a stable
 * Better Auth session id target.
 */
export async function recordBetterAuthSessionCreated(input: {
  userId: string;
  sessionId: string;
  tenantId: string;
  requestId?: string;
}) {
  return veritioAuth.recordSessionCreated({
    user: { id: input.userId },
    session: { id: input.sessionId },
    tenantId: input.tenantId,
    requestId: input.requestId,
  });
}
