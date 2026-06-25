import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import "../veritio-ui/styles.css";

/**
 * Defines the mandatory TanStack Start root route. It renders the HTML document
 * shell for every page and loads the shared Veritio design-kit stylesheet plus
 * the Geist font family (the same Google Fonts source the hosted Cloud uses) so
 * the example matches the product's visual language. All evidence logic stays
 * server-side; child routes expose only read/record actions.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Veritio · Governed changes (TanStack Start)" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap",
      },
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
    <html lang="en" className="antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
