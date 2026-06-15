import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Configures the TanStack Start dev/build toolchain for the reference example.
 * The Start plugin generates the client/server entries and the route tree, and
 * must precede the React plugin per TanStack's documented plugin ordering.
 */
export default defineConfig({
  plugins: [tanstackStart(), viteReact()],
});
