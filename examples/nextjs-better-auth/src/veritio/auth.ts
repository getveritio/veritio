import "server-only";

import { betterAuth } from "better-auth";
import { recordBetterAuthUserCreated } from "./auth-events";

export interface BetterAuthTenantBoundary {
  resolveTenantId(context: unknown): string;
  readRequestId?(context: unknown): string | undefined;
}

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
