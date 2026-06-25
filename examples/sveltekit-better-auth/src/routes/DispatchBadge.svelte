<script lang="ts">
import type { DispatchResult } from "$lib/server/cloud-ingest";
import Badge from "$lib/veritio-ui/Badge.svelte";

/**
 * Honest dispatch status pill: dispatched (emerald --success), failed
 * (warning), or local-only (muted). Re-authored from the React example's
 * `DispatchBadge`; it never claims delivery the server did not report.
 */
let { dispatch }: { dispatch: DispatchResult } = $props();
</script>

{#if dispatch.status === "dispatched"}
  <Badge variant="success" class="text-[10px]">Dispatched to Cloud</Badge>
{:else if dispatch.status === "failed"}
  <Badge variant="warning" class="text-[10px]">Dispatch failed · retrying</Badge>
{:else}
  <Badge variant="muted" class="text-[10px]">Captured locally</Badge>
{/if}
