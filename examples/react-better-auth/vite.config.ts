import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the React SPA. The Tailwind v4 plugin compiles the shared
 * Veritio design-kit stylesheet, and the `@` alias mirrors the hosted Cloud so
 * design-kit imports read identically across examples. The dev proxy forwards
 * `/api/*` to the Express server on port 3001 so the browser only ever calls
 * same-origin application routes and never talks to a storage backend or the
 * hosted ingest directly (the ingest key stays server-side).
 */
export default defineConfig({
  plugins: [tailwindcss(), react()],
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
