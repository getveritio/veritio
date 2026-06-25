<script lang="ts">
import type { HTMLInputAttributes } from "svelte/elements";
import { cn } from "./cn";

/**
 * Text input, re-authored 1:1 from the React design kit
 * (examples/_shared/veritio-ui/react/input.tsx) so the Svelte forms share the
 * same bordered zinc field + focus ring. `value` is bindable so the page can
 * two-way bind edit fields. Keep the class string in sync.
 */
type Props = { class?: string; value?: string | number } & Omit<HTMLInputAttributes, "class" | "value">;
let { class: className = "", value = $bindable(), ...rest }: Props = $props();
</script>

<input
  data-slot="input"
  bind:value
  class={cn(
    "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  {...rest}
/>
