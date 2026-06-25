<script setup lang="ts">
import { computed } from "vue";
import { cn } from "./utils";

/**
 * Border-defined surface card, re-authored as a Vue SFC against the SAME class
 * string as the shared design kit's `react/card.tsx` (rounded-xl, 1px border, no
 * heavy shadow) so example cards share the paper-on-zinc rhythm.
 */
const props = defineProps<{ class?: string }>();

const classes = computed(() => cn("bg-card text-card-foreground flex flex-col rounded-xl border", props.class));
</script>

<template>
  <div data-slot="card" :class="classes">
    <slot />
  </div>
</template>
