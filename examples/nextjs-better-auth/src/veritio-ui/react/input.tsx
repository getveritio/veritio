import type * as React from "react";

import { cn } from "../lib/utils";

/**
 * Text input. Copied 1:1 from veritio-cloud so example forms share the same
 * bordered zinc field + focus ring. Keep in sync with
 * veritio-cloud/src/components/ui/input.tsx (README SYNC NOTE).
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
