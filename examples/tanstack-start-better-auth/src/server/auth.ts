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
    baseURL: "http://localhost:5173",
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
 * Provides the reference tenant boundary for the TanStack Better Auth handler.
 * Production apps must replace this with Better Auth session plus organization
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
 * Exposes the local Better Auth instance mounted by TanStack Start route
 * handlers. This is an example host boundary, not a protocol authority.
 */
export const auth = createAuth(createReferenceTenantBoundary());

/**
 * Generates a process-local Better Auth secret for the reference app without
 * committing reusable credential material into the public example.
 */
function getLocalBetterAuthSecret(): string {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioTanStackBetterAuthSecret?: string;
  };
  referenceGlobal.__veritioTanStackBetterAuthSecret ??= `local-tanstack-${randomUUID()}`;
  return referenceGlobal.__veritioTanStackBetterAuthSecret;
}

/**
 * Reads optional correlation headers from Better Auth hook context without
 * trusting browser-controlled tenant fields.
 */
function readRequestIdFromBetterAuthContext(context: unknown): string | undefined {
  const headers = readHeaders(context);
  const value = headers?.get("x-request-id") ?? headers?.get("x-correlation-id");
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Extracts Headers when the framework exposes them to Better Auth hook context.
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
