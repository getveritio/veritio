import "server-only";

import { randomUUID } from "node:crypto";
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
    secret: getLocalBetterAuthSecret(),
    baseURL: "http://localhost:3000",
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

/**
 * Exposes the local Better Auth instance mounted by Next route handlers. This
 * remains an example host boundary; Better Auth does not define Veritio event
 * semantics or tenant scope.
 */
export const auth = createAuth(createReferenceTenantBoundary());

/**
 * Generates a process-local Better Auth secret for the reference app without
 * committing reusable credential material into the public example.
 */
function getLocalBetterAuthSecret(): string {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioNextBetterAuthSecret?: string;
  };
  referenceGlobal.__veritioNextBetterAuthSecret ??= `local-nextjs-${randomUUID()}`;
  return referenceGlobal.__veritioNextBetterAuthSecret;
}

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
