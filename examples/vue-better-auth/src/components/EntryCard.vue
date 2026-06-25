<script setup lang="ts">
import { ref } from "vue";
import type { EntryView, GovernedActionInput } from "../../server/governed-entries";
import Badge from "../veritio-ui/Badge.vue";
import Button from "../veritio-ui/Button.vue";
import Card from "../veritio-ui/Card.vue";
import CardContent from "../veritio-ui/CardContent.vue";
import CardHeader from "../veritio-ui/CardHeader.vue";
import Input from "../veritio-ui/Input.vue";

/**
 * One governed entity card: current state plus the three real governed actions
 * (Edit → update, Run cost agent → agent_recalc, Roll back → rollback). Mirrors
 * the React reference's EntryCard. It owns only transient form state; every
 * governed action is emitted up to App.vue, which POSTs it to the server-owned
 * engine — the browser never builds the change or supplies tenant/actor identity.
 */
const props = defineProps<{ entry: EntryView; busy: boolean }>();
const emit = defineEmits<{ action: [input: GovernedActionInput] }>();

const editing = ref(false);
const quantity = ref(String(props.entry.quantity));
const price = ref(String(props.entry.monthlyPrice));
const rollbackTo = ref("");

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Submits the edit form as a governed `update` action and closes the form. */
function submitEdit(): void {
  editing.value = false;
  emit("action", {
    kind: "update",
    entryId: props.entry.id,
    quantity: Number(quantity.value),
    monthlyPrice: Number(price.value),
  });
}
</script>

<template>
  <Card class="flex flex-col">
    <CardHeader class="flex-row items-start justify-between gap-3 space-y-0">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-foreground">{{ entry.name }}</p>
        <p class="truncate font-mono text-[11px] text-muted-foreground">{{ entry.id }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <Badge :variant="entry.status === 'active' ? 'secondary' : 'warning'" class="text-[10px] uppercase">
          {{ entry.status }}
        </Badge>
        <Badge variant="muted" class="font-mono text-[10px]">v{{ entry.version }}</Badge>
      </div>
    </CardHeader>

    <CardContent class="flex flex-1 flex-col gap-4">
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div class="min-w-0">
          <dt class="text-[11px] text-muted-foreground">Quantity</dt>
          <dd class="truncate font-medium text-foreground">{{ entry.quantity }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[11px] text-muted-foreground">Monthly price</dt>
          <dd class="truncate font-medium text-foreground">{{ usd.format(entry.monthlyPrice) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[11px] text-muted-foreground">Customer</dt>
          <dd class="truncate font-medium text-foreground" :title="entry.customerEmail">{{ entry.customerEmail }}</dd>
          <dd class="truncate text-[10px] text-muted-foreground">keyed digest in evidence</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[11px] text-muted-foreground">Revisions</dt>
          <dd class="truncate font-medium text-foreground">{{ entry.revisions.length }}</dd>
        </div>
      </dl>

      <form
        v-if="editing"
        class="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/20 p-3"
        @submit.prevent="submitEdit"
      >
        <label class="space-y-1">
          <span class="text-[11px] text-muted-foreground">Quantity</span>
          <Input v-model="quantity" type="number" :min="1" />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-muted-foreground">Monthly price</span>
          <Input v-model="price" type="number" :min="0" />
        </label>
        <div class="col-span-2 flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" @click="editing = false">Cancel</Button>
          <Button type="submit" size="sm" :disabled="busy">Save change</Button>
        </div>
      </form>

      <div class="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" :disabled="busy" @click="editing = !editing">Edit</Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="emit('action', { kind: 'agent_recalc', entryId: entry.id })"
        >
          Run cost agent
        </Button>
        <div v-if="entry.revisions.length > 0" class="flex items-center gap-1.5">
          <select
            aria-label="Roll back to revision"
            class="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            v-model="rollbackTo"
          >
            <option value="">Roll back to…</option>
            <option v-for="rev in entry.revisions" :key="rev.revisionId" :value="rev.revisionId">
              v{{ rev.version }} · {{ usd.format(rev.monthlyPrice) }}
            </option>
          </select>
          <Button
            size="sm"
            variant="outline"
            :disabled="busy || !rollbackTo"
            @click="emit('action', { kind: 'rollback', entryId: entry.id, rollbackToRevisionId: rollbackTo })"
          >
            Roll back
          </Button>
        </div>
        <span v-if="busy" class="text-[11px] text-muted-foreground">working…</span>
      </div>
    </CardContent>
  </Card>
</template>
