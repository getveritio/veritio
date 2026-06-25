<script lang="ts">
import type { Snippet } from "svelte";
// Import the shared Veritio design-kit stylesheet ONCE at the app root. The
// Tailwind v4 plugin (vite.config.ts) compiles `@import "tailwindcss"` plus the
// OKLCH-zinc tokens, `.bg-dotgrid`, and `--success` from this file.
import "../veritio-ui.css";

let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
