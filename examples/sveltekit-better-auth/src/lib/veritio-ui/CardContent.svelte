<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "./cn";

/**
 * Card body region (no top padding; pairs with CardHeader's inset). Mirrors the
 * React design kit's CardContent class string.
 */
type Props = { class?: string; children?: Snippet } & Omit<HTMLAttributes<HTMLDivElement>, "class">;
let { class: className = "", children, ...rest }: Props = $props();
</script>

<div data-slot="card-content" class={cn("px-5 pb-5", className)} {...rest}>
  {@render children?.()}
</div>
