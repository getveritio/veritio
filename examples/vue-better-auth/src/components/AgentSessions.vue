<script setup lang="ts">
import type { DispatchResult } from "../../server/cloud-ingest";
import type { AgentSessionView } from "../../server/governed-session";
import Badge from "../veritio-ui/Badge.vue";
import Button from "../veritio-ui/Button.vue";
import Card from "../veritio-ui/Card.vue";
import CardContent from "../veritio-ui/CardContent.vue";

/**
 * The agent-session capability: a trigger plus the sessions it has produced.
 * Mirrors the flagship's `AgentSessions` section. One run records a full governed
 * AI workflow (session → prompt → tool read → proposal → governed recalcs → human
 * approval) under one session id, which the Cloud projects onto its Agent
 * Sessions, Activity Graph, and Code Changes surfaces in addition to the
 * Changes/Entities the recalcs land on. The run is emitted up to App.vue, which
 * POSTs it to the server-owned engine; the browser never builds the session.
 */
defineProps<{ sessions: AgentSessionView[]; busy: boolean }>();
const emit = defineEmits<{ run: [] }>();

/** Honest dispatch status label (emerald only on a real Cloud dispatch). */
function dispatchLabel(dispatch: DispatchResult): string {
  if (dispatch.status === "dispatched") return "Dispatched to Cloud";
  if (dispatch.status === "failed") return "Dispatch failed · retrying";
  return "Captured locally";
}

/** Maps a dispatch status to the matching Badge variant. */
function dispatchVariant(dispatch: DispatchResult): "success" | "warning" | "muted" {
  if (dispatch.status === "dispatched") return "success";
  if (dispatch.status === "failed") return "warning";
  return "muted";
}
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-baseline justify-between gap-3 border-b border-border pb-2">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold tracking-tight text-foreground">Agent sessions</h2>
        <p class="text-[11px] text-muted-foreground">
          prompt → tool read → proposal → governed recalcs → human approval, grouped by one activity episode.
        </p>
      </div>
      <Button size="sm" :disabled="busy" @click="emit('run')">
        {{ busy ? "Running session…" : "Run agent session" }}
      </Button>
    </div>

    <Card v-if="sessions.length === 0">
      <CardContent class="p-8 text-center text-sm text-muted-foreground">
        No agent sessions yet — run one to populate the Cloud's Agent Sessions, Activity Graph, and Code Changes
        surfaces.
      </CardContent>
    </Card>
    <Card v-else class="overflow-hidden">
      <div
        v-for="session in sessions"
        :key="session.activityEpisodeId"
        class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
      >
        <div class="min-w-0">
          <p class="truncate font-mono text-[11px] text-foreground">{{ session.activityEpisodeId }}</p>
          <p class="truncate font-mono text-[10px] text-muted-foreground">{{ session.sessionId }}</p>
          <p class="truncate text-xs text-muted-foreground">{{ session.agentLabel }} · {{ session.modelLabel }}</p>
        </div>
        <div class="min-w-0 text-xs text-muted-foreground">
          <p class="truncate text-foreground">Recalculated {{ session.recalculated.length }}</p>
          <p class="truncate">{{ session.recalculated.join(", ") }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <Badge variant="secondary" class="text-[10px] capitalize">{{ session.outcome }}</Badge>
          <Badge :variant="dispatchVariant(session.dispatch)" class="text-[10px]">
            {{ dispatchLabel(session.dispatch) }}
          </Badge>
        </div>
      </div>
    </Card>
  </section>
</template>
