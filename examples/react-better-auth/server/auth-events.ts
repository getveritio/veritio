import { createBetterAuthVeritioAdapter } from "@veritio/better-auth";
import { auditRecorder } from "./veritio";

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
