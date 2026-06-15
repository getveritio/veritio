import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Defines the mandatory TanStack Start root route. It renders the HTML document
 * shell for every page; the reference example keeps all audit logic server-side
 * and exposes only read/record actions from child routes.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Veritio TanStack Start + Better Auth Reference" },
    ],
  }),
  component: RootComponent,
});

/**
 * Wraps matched child routes in the shared HTML document.
 */
function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

/**
 * Renders the HTML document shell. TanStack Start has no separate HTML entry, so
 * the root route owns `<html>`, head content, and the client script bundle.
 */
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
