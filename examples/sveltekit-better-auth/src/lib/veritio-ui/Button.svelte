<script lang="ts" module>
import type { Snippet } from "svelte";
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

/**
 * shadcn new-york button variants, re-authored 1:1 from the React design kit
 * (examples/_shared/veritio-ui/react/button.tsx) so the Svelte example renders
 * identical ink-on-zinc buttons. `default` is near-black --primary ink (NOT a
 * brand hue); emerald stays reserved for --success elsewhere. Keep the class
 * strings in sync with that file.
 */
export type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

const VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
  destructive: "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20",
  outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  link: "text-primary underline-offset-4 hover:underline",
};

const SIZES: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 rounded-md gap-1.5 px-3",
  lg: "h-10 rounded-md px-6",
  icon: "size-9",
};

/** Composes the variant/size class string for a button (exported for reuse). */
export function buttonClasses(variant: ButtonVariant = "default", size: ButtonSize = "default", className = ""): string {
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(" ");
}
</script>

<script lang="ts">
import { cn } from "./cn";

/**
 * Polymorphic button. Pass `href` to render an `<a>` styled as a button (the
 * React kit's `asChild` link pattern); otherwise it renders a native
 * `<button>`. Extra attributes (type, disabled, target, rel, onclick, …) pass
 * straight through.
 */
type Props = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  href?: string;
  children?: Snippet;
} & Omit<HTMLButtonAttributes, "class"> &
  Omit<HTMLAnchorAttributes, "class">;

let {
  variant = "default",
  size = "default",
  class: className = "",
  href,
  children,
  ...rest
}: Props = $props();
</script>

{#if href}
  <a data-slot="button" {href} class={cn(buttonClasses(variant, size, className))} {...rest}>
    {@render children?.()}
  </a>
{:else}
  <button data-slot="button" class={cn(buttonClasses(variant, size, className))} {...rest}>
    {@render children?.()}
  </button>
{/if}
