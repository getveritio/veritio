import { building } from "$app/environment";
import type { Handle } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { auth } from "$lib/server/auth";

/**
 * Mounts Better Auth at the SvelteKit server hook boundary. The auth handler
 * processes its own requests, and Veritio evidence is emitted from Better Auth
 * database hooks with tenant identity resolved on the server.
 */
export const handle: Handle = async ({ event, resolve }) => {
  return svelteKitHandler({ event, resolve, auth, building });
};
