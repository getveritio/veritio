import { createBetterAuthVeritioAdapter } from "@veritio/better-auth";
import { auditRecorder } from "./veritio";

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
