import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { recordBetterAuthUserCreated } from "./auth-events";
import { resolveReferenceSession } from "./veritio";

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
    baseURL: "http://localhost:3001",
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
 * Provides the reference tenant boundary used by the mounted Better Auth route.
 * Real apps should replace this with Better Auth session plus organization
 * membership lookup before emitting tenant-scoped Veritio evidence.
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
 * Exposes the local Better Auth instance mounted by the Express reference
 * server. This is an example host boundary, not a protocol authority.
 */
export const auth = createAuth(createReferenceTenantBoundary());

/**
 * Generates a process-local Better Auth secret for the reference app without
 * committing reusable credential material into the public example.
 */
function getLocalBetterAuthSecret(): string {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioVueBetterAuthSecret?: string;
  };
  referenceGlobal.__veritioVueBetterAuthSecret ??= `local-vue-${randomUUID()}`;
  return referenceGlobal.__veritioVueBetterAuthSecret;
}

/**
 * Reads optional request correlation headers from Better Auth context without
 * accepting tenant identity from browser-controlled fields.
 */
function readRequestIdFromBetterAuthContext(context: unknown): string | undefined {
  const headers = readHeaders(context);
  const value = headers?.get("x-request-id") ?? headers?.get("x-correlation-id");
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Extracts Headers when the current Better Auth integration exposes a Web
 * Request or direct headers object to database hooks.
 */
function readHeaders(context: unknown): Headers | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const maybeHeaders =
    (context as { headers?: unknown; request?: { headers?: unknown } }).headers ??
    (context as { request?: { headers?: unknown } }).request?.headers;
  return maybeHeaders instanceof Headers ? maybeHeaders : undefined;
}
