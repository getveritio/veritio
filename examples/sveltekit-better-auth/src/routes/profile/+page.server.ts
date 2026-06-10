import type { Actions } from "./$types";
import { auditRecorder, resolveReferenceSession } from "$lib/server/veritio";

export const actions: Actions = {
  updateProfile: async (event) => {
    const session = await resolveReferenceSession(event);
    const form = await event.request.formData();
    const profileId = String(form.get("profileId") ?? "");

    const record = await auditRecorder.record(
      {
        actor: { type: "user", id: session.actorUserId },
        action: "profile.updated",
        target: { type: "profile", id: profileId },
        scope: { tenantId: session.tenantId, environment: "reference" },
        purpose: "account_management",
        lawfulBasis: "contract",
        retention: "security_1y",
        metadata: {},
      },
      { idempotencyKey: `profile-updated:${session.tenantId}:${profileId}` },
    );

    return { sequence: record.sequence };
  },
};
