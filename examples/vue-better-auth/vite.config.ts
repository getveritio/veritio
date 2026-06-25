import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/**
 * Vite config for the Vue SPA. The Tailwind v4 plugin compiles the shared
 * Veritio design-kit stylesheet so this example renders the same OKLCH-zinc
 * tokens, `.bg-dotgrid`, and `--success` emerald as the hosted Cloud and the
 * React reference. The `@` alias mirrors those examples so leaf-component
 * imports read identically. The dev proxy forwards `/api/*` to the Express
 * server on port 3001 so the browser only ever calls same-origin application
 * routes and never talks to a storage backend or the hosted ingest directly
 * (the ingest key stays server-side).
 */
export default defineConfig({
  plugins: [tailwindcss(), vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
