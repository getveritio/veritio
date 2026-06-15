import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Builds the TanStack Start router for both server and client entries. The Start
 * Vite plugin discovers this factory; the generated route tree wires the
 * reference UI route and the server-owned audit endpoints together.
 */
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  });
}
