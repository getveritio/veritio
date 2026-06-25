import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

/**
 * Vite config for the SvelteKit app. The Tailwind v4 plugin compiles the shared
 * Veritio design-kit stylesheet (imported once from the root layout) so the
 * example renders the hosted Cloud's visual language. SvelteKit's own server
 * endpoints own all `/api/*` traffic, so there is no separate dev server or
 * proxy — the browser only ever calls same-origin routes and never talks to a
 * storage backend or the hosted ingest directly (the ingest key stays in
 * `$lib/server`, which is never bundled to the client).
 */
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
});
