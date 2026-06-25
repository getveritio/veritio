<script setup lang="ts">
import { computed } from "vue";
import { cn } from "./utils";

/**
 * Card header block, re-authored as a Vue SFC against the SAME class string as
 * the shared design kit's `react/card.tsx` CardHeader (stacked title +
 * description with a consistent p-5 inset). Callers can override the flow via the
 * `class` prop, exactly as the React kit does.
 */
const props = defineProps<{ class?: string }>();

const classes = computed(() => cn("flex flex-col gap-1.5 p-5", props.class));
</script>

<template>
  <div data-slot="card-header" :class="classes">
    <slot />
  </div>
</template>
