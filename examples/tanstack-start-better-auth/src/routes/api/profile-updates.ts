import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { referenceSessionToTanStackContext, resolveReferenceSession, tanstackAudit } from "../../server/veritio";

/**
 * Records a reference profile-update event through the TanStack Start adapter
 * after resolving the server-owned session. The browser never supplies tenant or
 * actor identity; only the target profile id is accepted and validated.
 */
export const Route = createFileRoute("/api/profile-updates")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const profileId = readProfileId(await readJsonBody(request));
        if (!profileId) {
          return Response.json({ error: "profileId must be 1-80 URL-safe identifier characters" }, { status: 400 });
        }
        const session = await resolveReferenceSession(request);
        const requestId = `ref_${randomUUID()}`;

        const record = await tanstackAudit.recordRouteHandler({
          context: referenceSessionToTanStackContext(session, requestId),
          action: "profile.updated",
          target: { type: "profile", id: profileId },
          purpose: "account_management",
          lawfulBasis: "contract",
          retention: "security_1y",
          metadata: { source: "tanstack_start_route_handler" },
          idempotencyKey: `tanstack:profile-updated:${profileId}:${requestId}`,
        });

        return Response.json({ record }, { status: 201 });
      },
    },
  },
});

/**
 * Parses the JSON request body, returning an empty object when the body is
 * absent so the handler can apply its own field validation.
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
 * id or idempotency-key component. Returns null for invalid input so the handler
 * can fail closed with a sanitized 400 rather than leaking an exception.
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
