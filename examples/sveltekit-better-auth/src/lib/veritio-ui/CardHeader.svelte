<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "./cn";

/**
 * Card header block: stacked title + meta with the kit's p-5 inset. Mirrors the
 * React design kit's CardHeader class string.
 */
type Props = { class?: string; children?: Snippet } & Omit<HTMLAttributes<HTMLDivElement>, "class">;
let { class: className = "", children, ...rest }: Props = $props();
</script>

<div data-slot="card-header" class={cn("flex flex-col gap-1.5 p-5", className)} {...rest}>
  {@render children?.()}
</div>
