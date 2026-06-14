import "server-only";

import { createBetterAuthVeritioAdapter } from "@veritio/better-auth";
import { auditRecorder } from "./server";

const veritioAuth = createBetterAuthVeritioAdapter({
  recorder: auditRecorder,
  environment: "reference",
});

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
