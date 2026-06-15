import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the React client. The dev proxy forwards `/api/*` to the
 * Express recorder on port 3001 so the browser only ever calls same-origin
 * application routes and never talks to a storage backend directly.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
