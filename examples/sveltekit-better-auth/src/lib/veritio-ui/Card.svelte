<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "./cn";

/**
 * Border-defined surface card, re-authored 1:1 from the React design kit
 * (examples/_shared/veritio-ui/react/card.tsx) so the Svelte example uses the
 * same paper-on-zinc rhythm (rounded-xl, 1px border, no heavy shadow). Keep the
 * class string in sync with that file.
 */
type Props = { class?: string; children?: Snippet } & Omit<HTMLAttributes<HTMLDivElement>, "class">;
let { class: className = "", children, ...rest }: Props = $props();
</script>

<div data-slot="card" class={cn("bg-card text-card-foreground flex flex-col rounded-xl border", className)} {...rest}>
  {@render children?.()}
</div>
