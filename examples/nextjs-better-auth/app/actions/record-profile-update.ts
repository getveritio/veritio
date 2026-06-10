"use server";

import { auditRecorder, resolveReferenceSession } from "../../src/veritio/server";

export async function recordProfileUpdate(input: {
  profileId: string;
  requestId?: string;
}) {
  const session = await resolveReferenceSession();

  return auditRecorder.record(
    {
      actor: { type: "user", id: session.actorUserId },
      action: "profile.updated",
      target: { type: "profile", id: input.profileId },
      scope: { tenantId: session.tenantId, environment: "reference" },
      requestId: input.requestId,
      purpose: "account_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {},
    },
    {
      idempotencyKey: `profile-updated:${session.tenantId}:${input.profileId}:${input.requestId ?? "manual"}`,
    },
  );
}
