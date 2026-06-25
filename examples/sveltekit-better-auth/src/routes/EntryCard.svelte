<script lang="ts">
import type { EntryView, GovernedActionInput } from "$lib/server/governed-entries";
import Badge from "$lib/veritio-ui/Badge.svelte";
import Button from "$lib/veritio-ui/Button.svelte";
import Card from "$lib/veritio-ui/Card.svelte";
import CardContent from "$lib/veritio-ui/CardContent.svelte";
import CardHeader from "$lib/veritio-ui/CardHeader.svelte";
import Input from "$lib/veritio-ui/Input.svelte";

/**
 * One governed entity: current state plus the three real governed actions
 * (edit → update, run cost agent, roll back). Re-authored from the React
 * example's `EntryCard`. Local edit/rollback selections are component state;
 * the actual mutation is delegated to the page via `onAction`, which POSTs to
 * the server endpoint and re-reads the snapshot.
 */
type Props = {
  entry: EntryView;
  busy: boolean;
  onAction: (input: GovernedActionInput) => void;
};
let { entry, busy, onAction }: Props = $props();

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

let editing = $state(false);
let quantity = $state("");
let price = $state("");
let rollbackTo = $state("");

/** Opens or closes the inline editor, seeding the fields from the current entry. */
function toggleEdit() {
  editing = !editing;
  if (editing) {
    quantity = String(entry.quantity);
    price = String(entry.monthlyPrice);
  }
}

/** Submits the inline edit form as a governed `update` action. */
function submitEdit(event: SubmitEvent) {
  event.preventDefault();
  editing = false;
  onAction({ kind: "update", entryId: entry.id, quantity: Number(quantity), monthlyPrice: Number(price) });
}
</script>

<Card class="flex flex-col">
  <CardHeader class="flex-row items-start justify-between gap-3 space-y-0">
    <div class="min-w-0">
      <p class="truncate text-sm font-semibold text-foreground">{entry.name}</p>
      <p class="truncate font-mono text-[11px] text-muted-foreground">{entry.id}</p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <Badge variant={entry.status === "active" ? "secondary" : "warning"} class="text-[10px] uppercase">
        {entry.status}
      </Badge>
      <Badge variant="muted" class="font-mono text-[10px]">v{entry.version}</Badge>
    </div>
  </CardHeader>

  <CardContent class="flex flex-1 flex-col gap-4">
    <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div class="min-w-0">
        <dt class="text-[11px] text-muted-foreground">Quantity</dt>
        <dd class="truncate font-medium text-foreground" title={String(entry.quantity)}>{entry.quantity}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-[11px] text-muted-foreground">Monthly price</dt>
        <dd class="truncate font-medium text-foreground" title={usd.format(entry.monthlyPrice)}>
          {usd.format(entry.monthlyPrice)}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-[11px] text-muted-foreground">Customer</dt>
        <dd class="truncate font-medium text-foreground" title={entry.customerEmail}>{entry.customerEmail}</dd>
        <dd class="truncate text-[10px] text-muted-foreground">keyed digest in evidence</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-[11px] text-muted-foreground">Revisions</dt>
        <dd class="truncate font-medium text-foreground">{entry.revisions.length}</dd>
      </div>
    </dl>

    {#if editing}
      <form class="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/20 p-3" onsubmit={submitEdit}>
        <label class="space-y-1">
          <span class="text-[11px] text-muted-foreground">Quantity</span>
          <Input type="number" min={1} bind:value={quantity} />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-muted-foreground">Monthly price</span>
          <Input type="number" min={0} bind:value={price} />
        </label>
        <div class="col-span-2 flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onclick={() => (editing = false)}>Cancel</Button>
          <Button type="submit" size="sm" disabled={busy}>Save change</Button>
        </div>
      </form>
    {/if}

    <div class="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <Button size="sm" variant="outline" disabled={busy} onclick={toggleEdit}>Edit</Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onclick={() => onAction({ kind: "agent_recalc", entryId: entry.id })}
      >
        Run cost agent
      </Button>
      {#if entry.revisions.length > 0}
        <div class="flex items-center gap-1.5">
          <select
            aria-label="Roll back to revision"
            class="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            bind:value={rollbackTo}
          >
            <option value="">Roll back to…</option>
            {#each entry.revisions as rev (rev.revisionId)}
              <option value={rev.revisionId}>v{rev.version} · {usd.format(rev.monthlyPrice)}</option>
            {/each}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !rollbackTo}
            onclick={() => onAction({ kind: "rollback", entryId: entry.id, rollbackToRevisionId: rollbackTo })}
          >
            Roll back
          </Button>
        </div>
      {/if}
      {#if busy}<span class="text-[11px] text-muted-foreground">working…</span>{/if}
    </div>
  </CardContent>
</Card>
