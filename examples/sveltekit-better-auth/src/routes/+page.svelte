<script lang="ts">
import { onMount } from "svelte";
import type { CloudPublicConfig } from "$lib/server/cloud-ingest";
import type {
  ChangeFeedItem,
  EntryView,
  GovernedActionInput,
  GovernedActionResult,
} from "$lib/server/governed-entries";
import type { AgentSessionView } from "$lib/server/governed-session";
import Badge from "$lib/veritio-ui/Badge.svelte";
import Button from "$lib/veritio-ui/Button.svelte";
import Card from "$lib/veritio-ui/Card.svelte";
import CardContent from "$lib/veritio-ui/CardContent.svelte";
import AgentSessions from "./AgentSessions.svelte";
import DispatchBadge from "./DispatchBadge.svelte";
import EntryCard from "./EntryCard.svelte";

/**
 * The flagship governed-action demo in a SvelteKit app. A real UI action (edit
 * an entry, run the cost agent, roll back) is POSTed to this app's OWN server
 * endpoint (`/api/governed`), which captures it through the SDK, stages it in a
 * transactional outbox, and dispatches server-to-server to the hosted Veritio
 * Cloud — where it appears live on the Changes / Entities surfaces. The browser
 * never sees the ingest key or the tenant; the `$lib/server` boundary owns all
 * of it. The page reads the snapshot once on mount and re-reads it after every
 * action.
 */

/** The shape the `GET /api/governed` endpoint returns. */
interface GovernedSnapshot {
  entries: EntryView[];
  feed: ChangeFeedItem[];
  sessions: AgentSessionView[];
  cloud: CloudPublicConfig;
}

let snapshot = $state<GovernedSnapshot | null>(null);
let loadError = $state<string | null>(null);
let busyId = $state<string | null>(null);
let last = $state<GovernedActionResult | null>(null);
let error = $state<string | null>(null);
let sessionBusy = $state(false);

// Initial read of an external system (this app's server endpoint). There is no
// loader/query lib wired into this client page, so a single guarded
// fetch-on-mount is the sanctioned lifecycle use (rule 08). Re-reads after an
// action go through `refresh()` from the event handler, not a reactive effect.
onMount(() => {
  const controller = new AbortController();
  void refresh(controller.signal);
  return () => controller.abort();
});

/** Reads the current snapshot from the server endpoint, ignoring aborts. */
async function refresh(signal?: AbortSignal) {
  try {
    const response = await fetch("/api/governed", { signal });
    if (!response.ok) {
      loadError = "Could not load the governed snapshot from /api/governed.";
      return;
    }
    snapshot = (await response.json()) as GovernedSnapshot;
    loadError = null;
  } catch (cause) {
    if ((cause as Error)?.name === "AbortError") return;
    loadError = "Could not reach the governed snapshot endpoint. Is the SvelteKit server running?";
  }
}

/** Posts one governed action, then re-reads the snapshot to show the result. */
async function act(input: GovernedActionInput) {
  busyId = input.entryId;
  error = null;
  try {
    const response = await fetch("/api/governed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      error = "The governed action failed on the server. Check the dev server logs.";
      return;
    }
    last = (await response.json()) as GovernedActionResult;
    await refresh();
  } catch {
    error = "The governed action could not reach the server endpoint.";
  } finally {
    busyId = null;
  }
}

/** Runs one governed agent session on the server, then re-reads the snapshot. */
async function runSession() {
  sessionBusy = true;
  error = null;
  try {
    const response = await fetch("/api/governed/session", { method: "POST" });
    if (!response.ok) {
      error = "The agent session failed on the server. Check the dev server logs.";
      return;
    }
    await refresh();
  } catch {
    error = "The agent session could not reach the server endpoint.";
  } finally {
    sessionBusy = false;
  }
}
</script>

{#if !snapshot}
  <div class="grid min-h-screen place-items-center bg-dotgrid">
    <p class="text-sm text-muted-foreground">{loadError ?? "Loading governed snapshot…"}</p>
  </div>
{:else}
  <div class="min-h-screen bg-dotgrid">
    <header class="sticky top-0 z-10 border-b border-border bg-card/85 backdrop-blur-md">
      <div class="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
        <span class="size-2.5 rounded-full bg-success" aria-hidden="true"></span>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold tracking-tight text-foreground">Veritio · Governed changes</p>
          <p class="truncate text-[11px] text-muted-foreground">
            SvelteKit reference — edit → capture → outbox → hosted ingest
          </p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          {#if snapshot.cloud.configured}
            <Badge variant="success" class="font-mono text-[10px]">
              Cloud · {snapshot.cloud.projectId?.slice(0, 8)}…
            </Badge>
          {:else}
            <Badge variant="muted" class="text-[10px]">Local only</Badge>
          {/if}
          {#if snapshot.cloud.configured && snapshot.cloud.changesUrl}
            <Button href={snapshot.cloud.changesUrl} target="_blank" rel="noreferrer" size="sm" variant="outline" class="h-8">
              View in Veritio Cloud
            </Button>
          {/if}
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <Card class="bg-card/60">
        <CardContent class="space-y-2 p-5 text-sm text-muted-foreground">
          <p class="text-foreground">
            A real UI action becomes a governed <span class="font-medium">Change</span>: captured by
            <code class="font-mono text-xs">createGovernedActionDraft</code>, staged in a transactional outbox, and
            dispatched to the hosted Cloud ingest. Tenant and the ingest key stay on the SvelteKit server; the browser
            never sees them.
          </p>
          {#if snapshot.cloud.configured}
            <p>
              Dispatching to <span class="font-mono text-xs text-foreground">{snapshot.cloud.baseUrl}</span> · project
              <span class="font-mono text-xs text-foreground">{snapshot.cloud.projectId}</span>. Open the Cloud →
              Evidence → Changes to watch entries land.
            </p>
          {:else}
            <p>
              Running <span class="font-medium text-foreground">local-only</span>. Set
              <code class="font-mono text-xs">VERITIO_CLOUD_BASE_URL</code>,
              <code class="font-mono text-xs">VERITIO_CLOUD_PROJECT_ID</code>, and
              <code class="font-mono text-xs">VERITIO_CLOUD_INGEST_TOKEN</code> (an <em>ingest</em> scoped key from the
              Cloud console) on the SvelteKit server and restart to dispatch end-to-end.
            </p>
          {/if}
        </CardContent>
      </Card>

      {#if last}
        <div class="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
          <div class="min-w-0 space-y-1">
            <p class="text-sm text-foreground">
              Recorded <span class="font-medium">{last.changeType}</span> ·
              <span class="font-mono text-xs text-muted-foreground">{last.changeId}</span>
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <DispatchBadge dispatch={last.dispatch} />
              {#if last.cloud.configured && last.cloud.changesUrl}
                <a
                  class="text-xs text-foreground underline-offset-2 hover:underline"
                  href={last.cloud.changesUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View in Veritio Cloud →
                </a>
              {/if}
              {#if last.dispatch.error}
                <span class="font-mono text-[11px] text-destructive">{last.dispatch.error}</span>
              {/if}
            </div>
          </div>
          <Button size="icon" variant="ghost" aria-label="Dismiss" onclick={() => (last = null)}>✕</Button>
        </div>
      {/if}

      {#if error}
        <p class="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      {/if}

      <section class="space-y-3">
        <div class="flex items-baseline justify-between gap-3 border-b border-border pb-2">
          <h2 class="text-sm font-semibold tracking-tight text-foreground">Governed entities</h2>
          <p class="text-[11px] text-muted-foreground">Each action below records one governed change.</p>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          {#each snapshot.entries as entry (entry.id)}
            <EntryCard {entry} busy={busyId === entry.id} onAction={act} />
          {/each}
        </div>
      </section>

      <AgentSessions sessions={snapshot.sessions} busy={sessionBusy} onRun={runSession} />

      <section class="space-y-3">
        <div class="flex items-baseline justify-between gap-3 border-b border-border pb-2">
          <h2 class="text-sm font-semibold tracking-tight text-foreground">Recent governed changes</h2>
          <p class="text-[11px] text-muted-foreground">
            {snapshot.cloud.configured
              ? "Dispatched server-to-server to Veritio Cloud."
              : "Local only — configure the cloud to dispatch."}
          </p>
        </div>
        {#if snapshot.feed.length === 0}
          <Card>
            <CardContent class="p-8 text-center text-sm text-muted-foreground">
              No governed changes yet — edit an entry, run the cost agent, or roll back to record the first one.
            </CardContent>
          </Card>
        {:else}
          <Card class="overflow-hidden">
            {#each snapshot.feed as item (item.changeId)}
              <div
                class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm text-foreground">{item.changeType}</p>
                  <p class="truncate font-mono text-[11px] text-muted-foreground">{item.changeId}</p>
                </div>
                <div class="min-w-0 text-xs text-muted-foreground">
                  <p class="truncate">{item.entryName}</p>
                  <p class="truncate">{item.actorLabel}</p>
                </div>
                <DispatchBadge dispatch={item.dispatch} />
              </div>
            {/each}
          </Card>
        {/if}
      </section>
    </main>
  </div>
{/if}
