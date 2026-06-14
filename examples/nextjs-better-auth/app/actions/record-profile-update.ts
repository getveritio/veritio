"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  nextAudit,
  referenceSessionToNextContext,
  resolveReferenceSession,
} from "../../src/veritio/server";

/**
 * Records a profile update after resolving the server-side reference session,
 * then redirects to the tenant-scoped audit trail.
 */
export async function recordProfileUpdate(formData: FormData) {
  const session = await resolveReferenceSession();
  const profileId = readRequiredIdentifier(formData, "profileId");
  const requestId = `ref_${randomUUID()}`;

  await nextAudit.recordServerAction({
    context: referenceSessionToNextContext(session, requestId),
    action: "profile.updated",
    target: { type: "profile", id: profileId },
    purpose: "account_management",
    lawfulBasis: "contract",
    retention: "security_1y",
    metadata: { source: "app_router_server_action" },
    idempotencyKey: `nextjs:profile-updated:${profileId}:${requestId}`,
  });

  revalidatePath("/");
  revalidatePath("/audit");
  redirect("/audit");
}

/**
 * Validates a form identifier before it becomes a resource id or idempotency key
 * component.
 */
function readRequiredIdentifier(formData: FormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== "string") {
    throw new TypeError(`${field} is required`);
  }

  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(trimmed)) {
    throw new TypeError(`${field} must be 1-80 URL-safe identifier characters`);
  }
  return trimmed;
}
