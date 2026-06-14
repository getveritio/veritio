import "server-only";

import { betterAuth } from "better-auth";
import { recordBetterAuthUserCreated } from "./auth-events";
import { resolveReferenceSession } from "./server";

export interface BetterAuthTenantBoundary {
  resolveTenantId(context: unknown): string | Promise<string>;
  readRequestId?(context: unknown): string | undefined;
}

/**
 * Creates the reference Better Auth instance with server-owned tenant resolution
 * before emitting Veritio audit events from database hooks.
 */
export function createAuth(boundary: BetterAuthTenantBoundary) {
  return betterAuth({
    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            await recordBetterAuthUserCreated({
              userId: user.id,
              tenantId: await boundary.resolveTenantId(context),
              requestId: boundary.readRequestId?.(context),
            });
          },
        },
      },
    },
  });
}

/**
 * Provides the example tenant boundary. Real apps must replace this with a
 * Better Auth session plus organization membership lookup.
 */
export function createReferenceTenantBoundary(): BetterAuthTenantBoundary {
  return {
    async resolveTenantId(context) {
      return (await resolveReferenceSession(context)).tenantId;
    },
    readRequestId: readRequestIdFromBetterAuthContext,
  };
}

export const auth = createAuth(createReferenceTenantBoundary());

/**
 * Reads correlation ids from Better Auth request context without trusting client
 * form fields for tenant identity.
 */
function readRequestIdFromBetterAuthContext(context: unknown): string | undefined {
  const headers = readHeaders(context);
  const value = headers?.get("x-request-id") ?? headers?.get("x-correlation-id");
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Extracts Headers from the Better Auth hook context when the framework exposes
 * them.
 */
function readHeaders(context: unknown): Headers | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const maybeHeaders =
    (context as { headers?: unknown; request?: { headers?: unknown } }).headers
    ?? (context as { request?: { headers?: unknown } }).request?.headers;
  return maybeHeaders instanceof Headers ? maybeHeaders : undefined;
}
