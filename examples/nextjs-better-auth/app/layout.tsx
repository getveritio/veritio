import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veritio Next.js Better Auth Reference",
  description: "Server-side Veritio audit trail reference for Next.js App Router and Better Auth.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">
            Veritio
          </Link>
          <nav aria-label="Primary">
            <Link href="/">Record</Link>
            <Link href="/audit">Audit trail</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
