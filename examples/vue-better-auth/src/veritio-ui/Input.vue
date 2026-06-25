<script setup lang="ts">
import { computed } from "vue";
import { cn } from "./utils";

/**
 * Text input, re-authored as a Vue SFC against the SAME class string as the
 * shared design kit's `react/input.tsx` so example forms share the bordered zinc
 * field + focus ring. Supports `v-model`; `type` and any extra attrs fall
 * through to the underlying <input> (`inheritAttrs` is off so they land on the
 * element, not the wrapper).
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  modelValue?: string | number;
  class?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const classes = computed(() =>
  cn(
    "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    props.class,
  ),
);
</script>

<template>
  <input
    data-slot="input"
    :class="classes"
    :value="modelValue"
    v-bind="$attrs"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
