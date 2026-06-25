import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Configures the TanStack Start dev/build toolchain for the reference example.
 * The Tailwind v4 plugin compiles the shared Veritio design-kit stylesheet; the
 * Start plugin generates the client/server entries and the route tree and must
 * precede the React plugin per TanStack's documented plugin ordering. The `@`
 * alias mirrors the hosted Cloud so design-kit imports read identically.
 */
export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
