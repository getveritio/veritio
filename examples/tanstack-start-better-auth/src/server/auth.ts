import { betterAuth } from "better-auth";
import { recordBetterAuthUserCreated } from "./auth-events";

export interface BetterAuthTenantBoundary {
  resolveTenantId(context: unknown): string;
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
              tenantId: boundary.resolveTenantId(context),
              requestId: boundary.readRequestId?.(context),
            });
          },
        },
      },
    },
  });
}
