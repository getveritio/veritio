<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { CloudPublicConfig } from "../server/cloud-ingest";
import type {
  ChangeFeedItem,
  EntryView,
  GovernedActionInput,
  GovernedActionResult,
} from "../server/governed-entries";
import type { AgentSessionView } from "../server/governed-session";
import Badge from "./veritio-ui/Badge.vue";
import Button from "./veritio-ui/Button.vue";
import Card from "./veritio-ui/Card.vue";
import CardContent from "./veritio-ui/CardContent.vue";
import CardHeader from "./veritio-ui/CardHeader.vue";
import AgentSessions from "./components/AgentSessions.vue";
import EntryCard from "./components/EntryCard.vue";

/**
 * The flagship governed-action demo, in a Vue 3 SPA. A real UI action (edit an
 * entry, run the cost agent, roll back) is POSTed to this app's OWN Express
 * server, which captures it through the SDK, stages it in a transactional
 * outbox, and dispatches server-to-server to the hosted Veritio Cloud — where it
 * appears live on the Changes / Entities surfaces. The browser never sees the
 * ingest key or the tenant; the Express endpoints own all of it. The SPA loads
 * the snapshot once on mount and re-reads it after every action.
 */

/** The shape the Express `GET /api/governed/snapshot` endpoint returns. */
interface GovernedSnapshot {
  entries: EntryView[];
  feed: ChangeFeedItem[];
  sessions: AgentSessionView[];
  cloud: CloudPublicConfig;
}

const snapshot = ref<GovernedSnapshot | null>(null);
const loadError = ref<string | null>(null);
const busyId = ref<string | null>(null);
const sessionBusy = ref(false);
const last = ref<GovernedActionResult | null>(null);
const error = ref<string | null>(null);

// Initial read of an external system (the Express server). No loader/query lib
// is wired up in this SPA, so a single guarded fetch-on-mount with an
// AbortController is the sanctioned lifecycle use (see rule 08). Re-reads after
// an action go through `refresh()` from the action handler, not a watcher.
const controller = new AbortController();
onMounted(() => {
  void refresh(controller.signal);
});
onBeforeUnmount(() => controller.abort());

/** Reads the current snapshot from the server, ignoring aborts. */
async function refresh(signal?: AbortSignal): Promise<void> {
  try {
    const response = await fetch("/api/governed/snapshot", { signal });
    if (!response.ok) {
      loadError.value = "Could not load the governed snapshot. Is the Express server running on :3001?";
      return;
    }
    snapshot.value = (await response.json()) as GovernedSnapshot;
    loadError.value = null;
  } catch (cause) {
    if ((cause as Error)?.name === "AbortError") return;
    loadError.value = "Could not reach the Express server on :3001. Start it with `bun run dev:server`.";
  }
}

/** Posts one governed action, then re-reads the snapshot to show the result. */
async function act(input: GovernedActionInput): Promise<void> {
  busyId.value = input.entryId;
  error.value = null;
  try {
    const response = await fetch("/api/governed/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      error.value = "The governed action failed on the server. Check the dev server logs.";
      return;
    }
    last.value = (await response.json()) as GovernedActionResult;
    await refresh();
  } catch {
    error.value = "The governed action could not reach the Express server.";
  } finally {
    busyId.value = null;
  }
}

/** Runs one governed agent session, then re-reads the snapshot to show it. */
async function runSession(): Promise<void> {
  sessionBusy.value = true;
  error.value = null;
  try {
    const response = await fetch("/api/governed/session", { method: "POST" });
    if (!response.ok) {
      error.value = "The agent session failed on the server. Check the dev server logs.";
      return;
    }
    await refresh();
  } catch {
    error.value = "The agent session could not reach the Express server.";
  } finally {
    sessionBusy.value = false;
  }
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Honest dispatch status label for the badge. */
function dispatchLabel(dispatch: GovernedActionResult["dispatch"]): string {
  if (dispatch.status === "dispatched") return "Dispatched to Cloud";
  if (dispatch.status === "failed") return "Dispatch failed · retrying";
  return "Captured locally";
}

/** Maps a dispatch status to the matching Badge variant (emerald only on success). */
function dispatchVariant(dispatch: GovernedActionResult["dispatch"]): "success" | "warning" | "muted" {
  if (dispatch.status === "dispatched") return "success";
  if (dispatch.status === "failed") return "warning";
  return "muted";
}
</script>

<template>
  <div v-if="!snapshot" class="grid min-h-screen place-items-center bg-dotgrid">
    <p class="text-sm text-muted-foreground">{{ loadError ?? "Loading governed snapshot…" }}</p>
  </div>

  <div v-else class="min-h-screen bg-dotgrid">
    <!-- Sticky topbar mirroring the Cloud's chrome: brand, cloud status, deep link. -->
    <header class="sticky top-0 z-10 border-b border-border bg-card/85 backdrop-blur-md">
      <div class="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
        <span class="size-2.5 rounded-full bg-success" aria-hidden="true" />
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold tracking-tight text-foreground">Veritio · Governed changes</p>
          <p class="truncate text-[11px] text-muted-foreground">
            Vue + Express reference — edit → capture → outbox → hosted ingest
          </p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <Badge v-if="snapshot.cloud.configured" variant="success" class="font-mono text-[10px]">
            Cloud · {{ snapshot.cloud.projectId?.slice(0, 8) }}…
          </Badge>
          <Badge v-else variant="muted" class="text-[10px]">Local only</Badge>
          <Button
            v-if="snapshot.cloud.configured && snapshot.cloud.changesUrl"
            as="a"
            size="sm"
            variant="outline"
            class="h-8"
            :href="snapshot.cloud.changesUrl"
            target="_blank"
            rel="noreferrer"
          >
            View in Veritio Cloud
          </Button>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <!-- Explains the loop, and how to point the example at a hosted Cloud project. -->
      <Card class="bg-card/60">
        <CardContent class="space-y-2 p-5 text-sm text-muted-foreground">
          <p class="text-foreground">
            A real UI action becomes a governed <span class="font-medium">Change</span>: captured by
            <code class="font-mono text-xs">createGovernedActionDraft</code>, staged in a transactional outbox, and
            dispatched to the hosted Cloud ingest. Tenant and the ingest key stay on the Express server; the browser
            never sees them.
          </p>
          <p v-if="snapshot.cloud.configured">
            Dispatching to <span class="font-mono text-xs text-foreground">{{ snapshot.cloud.baseUrl }}</span> · project
            <span class="font-mono text-xs text-foreground">{{ snapshot.cloud.projectId }}</span
            >. Open the Cloud → Evidence → Changes to watch entries land.
          </p>
          <p v-else>
            Running <span class="font-medium text-foreground">local-only</span>. Set
            <code class="font-mono text-xs">VERITIO_CLOUD_BASE_URL</code>,
            <code class="font-mono text-xs">VERITIO_CLOUD_PROJECT_ID</code>, and
            <code class="font-mono text-xs">VERITIO_CLOUD_INGEST_TOKEN</code> (an <em>ingest</em> scoped key from the
            Cloud console) on the Express server and restart to dispatch end-to-end.
          </p>
        </CardContent>
      </Card>

      <!-- Transient banner showing the most recent change + its dispatch outcome. -->
      <div
        v-if="last"
        class="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-4 py-3"
      >
        <div class="min-w-0 space-y-1">
          <p class="text-sm text-foreground">
            Recorded <span class="font-medium">{{ last.changeType }}</span> ·
            <span class="font-mono text-xs text-muted-foreground">{{ last.changeId }}</span>
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <Badge :variant="dispatchVariant(last.dispatch)" class="text-[10px]">
              {{ dispatchLabel(last.dispatch) }}
            </Badge>
            <a
              v-if="last.cloud.configured && last.cloud.changesUrl"
              class="text-xs text-foreground underline-offset-2 hover:underline"
              :href="last.cloud.changesUrl"
              target="_blank"
              rel="noreferrer"
            >
              View in Veritio Cloud →
            </a>
            <span v-if="last.dispatch.error" class="font-mono text-[11px] text-destructive">
              {{ last.dispatch.error }}
            </span>
          </div>
        </div>
        <Button size="icon" variant="ghost" aria-label="Dismiss" @click="last = null">✕</Button>
      </div>

      <p
        v-if="error"
        class="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {{ error }}
      </p>

      <section class="space-y-3">
        <div class="flex items-baseline justify-between gap-3 border-b border-border pb-2">
          <h2 class="text-sm font-semibold tracking-tight text-foreground">Governed entities</h2>
          <p class="text-[11px] text-muted-foreground">Each action below records one governed change.</p>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <EntryCard
            v-for="entry in snapshot.entries"
            :key="entry.id"
            :entry="entry"
            :busy="busyId === entry.id"
            @action="act"
          />
        </div>
      </section>

      <AgentSessions :sessions="snapshot.sessions" :busy="sessionBusy" @run="runSession" />

      <section class="space-y-3">
        <div class="flex items-baseline justify-between gap-3 border-b border-border pb-2">
          <h2 class="text-sm font-semibold tracking-tight text-foreground">Recent governed changes</h2>
          <p class="text-[11px] text-muted-foreground">
            {{
              snapshot.cloud.configured
                ? "Dispatched server-to-server to Veritio Cloud."
                : "Local only — configure the cloud to dispatch."
            }}
          </p>
        </div>

        <Card v-if="snapshot.feed.length === 0">
          <CardContent class="p-8 text-center text-sm text-muted-foreground">
            No governed changes yet — edit an entry, run the cost agent, or roll back to record the first one.
          </CardContent>
        </Card>
        <Card v-else class="overflow-hidden">
          <div
            v-for="item in snapshot.feed"
            :key="item.changeId"
            class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
          >
            <div class="min-w-0">
              <p class="truncate text-sm text-foreground">{{ item.changeType }}</p>
              <p class="truncate font-mono text-[11px] text-muted-foreground">{{ item.changeId }}</p>
            </div>
            <div class="min-w-0 text-xs text-muted-foreground">
              <p class="truncate">{{ item.entryName }}</p>
              <p class="truncate">{{ item.actorLabel }}</p>
            </div>
            <Badge :variant="dispatchVariant(item.dispatch)" class="text-[10px]">
              {{ dispatchLabel(item.dispatch) }}
            </Badge>
          </div>
        </Card>
      </section>
    </main>
  </div>
</template>
