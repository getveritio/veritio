import { json, type RequestHandler } from "@sveltejs/kit";
import { auditRecorder, resolveReferenceSession } from "$lib/server/veritio";

/**
 * Records a reference profile-update event through the server-resolved tenant
 * scope. Tenant and actor identity come from the server boundary, never from the
 * browser; only the target profile id is accepted and validated, failing closed
 * with a sanitized 400 on invalid input.
 */
export const POST: RequestHandler = async (event) => {
  const profileId = readProfileId(await readJsonBody(event.request));
  if (!profileId) {
    return json({ error: "profileId must be 1-80 URL-safe identifier characters" }, { status: 400 });
  }

  const session = await resolveReferenceSession(event);
  const requestId = `ref_${crypto.randomUUID()}`;
  const record = await auditRecorder.record(
    {
      actor: { type: "user", id: session.actorUserId },
      action: "profile.updated",
      target: { type: "profile", id: profileId },
      scope: { tenantId: session.tenantId, environment: "reference" },
      requestId,
      purpose: "account_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: { source: "sveltekit_server_route" },
    },
    { idempotencyKey: `sveltekit:profile-updated:${profileId}:${requestId}` },
  );

  return json({ record }, { status: 201 });
};

/**
 * Parses the JSON request body, returning an empty object when the body is absent
 * so the handler can apply its own field validation.
 */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * Validates the browser-supplied profile id before it becomes a hashed resource
 * id or idempotency-key component. Returns null for invalid input.
 */
function readProfileId(body: unknown): string | null {
  const value = (body as { profileId?: unknown } | null)?.profileId;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}
