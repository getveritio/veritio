import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * Border-defined surface card. Copied 1:1 from veritio-cloud so example apps
 * use the same paper-on-zinc card rhythm (rounded-xl, 1px border, no heavy
 * shadow). Keep in sync with veritio-cloud/src/components/ui/card.tsx.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("bg-card text-card-foreground flex flex-col rounded-xl border", className)}
      {...props}
    />
  );
}

/** Card header block: stacked title + description with consistent p-5 inset. */
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />;
}

/** Card title — semibold, tight leading; pairs with CardDescription. */
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-title" className={cn("font-semibold leading-none", className)} {...props} />;
}

/** Muted supporting copy under a CardTitle. */
function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

/** Card body region (no top padding; pairs with CardHeader's inset). */
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-5 pb-5", className)} {...props} />;
}

/** Card footer for actions; horizontally aligned, shares the p-5 inset. */
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center px-5 pb-5", className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
