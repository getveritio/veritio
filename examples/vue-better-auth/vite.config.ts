import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/**
 * Vite config for the Vue client. The dev proxy forwards `/api/*` to the Express
 * recorder on port 3001 so the browser only ever calls same-origin application
 * routes and never talks to a storage backend directly.
 */
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
