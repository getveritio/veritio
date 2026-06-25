import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veritio · Governed changes (Next.js)",
  description:
    "Server-owned governed-change reference: a Next.js App Router action captures a change through the Veritio SDK and dispatches it to hosted Veritio Cloud.",
};

/**
 * Root layout. It loads Geist / Geist Mono from Google Fonts (the kit's
 * styles.css only wires the font *names* into the token stack, so the consuming
 * app must supply the font itself) and renders the page bare — the home page
 * owns its own dot-grid shell and topbar, matching the flagship example.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Geist:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
