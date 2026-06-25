<script lang="ts" module>
/**
 * Status pill variants, re-authored 1:1 from the React design kit
 * (examples/_shared/veritio-ui/react/badge.tsx). `success` is the ONLY
 * emerald-tinted variant (bg-success/15) — it maps to the reserved --success
 * token; do not add other hue variants. Keep the class strings in sync.
 */
export type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "muted";
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "./cn";

const BASE =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0";

const VARIANTS: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary/15 text-primary",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  outline: "border-border text-foreground",
  success: "border-transparent bg-success/15 text-success",
  warning: "border-transparent bg-warning/20 text-warning-foreground dark:text-warning",
  muted: "border-transparent bg-muted text-muted-foreground",
};

/** Inline status pill; renders as a <span> so it nests in text and table cells. */
type Props = { variant?: BadgeVariant; class?: string; children?: Snippet } & Omit<
  HTMLAttributes<HTMLSpanElement>,
  "class"
>;
let { variant = "default", class: className = "", children, ...rest }: Props = $props();
</script>

<span data-slot="badge" class={cn(BASE, VARIANTS[variant], className)} {...rest}>
  {@render children?.()}
</span>
