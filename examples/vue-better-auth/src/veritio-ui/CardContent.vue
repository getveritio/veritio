<script setup lang="ts">
import { computed } from "vue";
import { cn } from "./utils";

/**
 * Card body region, re-authored as a Vue SFC against the SAME class string as
 * the shared design kit's `react/card.tsx` CardContent (no top padding; pairs
 * with CardHeader's inset).
 */
const props = defineProps<{ class?: string }>();

const classes = computed(() => cn("px-5 pb-5", props.class));
</script>

<template>
  <div data-slot="card-content" :class="classes">
    <slot />
  </div>
</template>
