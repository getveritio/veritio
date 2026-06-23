import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../src/veritio/auth";

/**
 * Mounts Better Auth at the Next.js server route boundary while Veritio tenant
 * scope remains resolved by the injected reference boundary in `auth`.
 */
export const { GET, POST } = toNextJsHandler(auth);
