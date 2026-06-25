<script lang="ts">
import type { AgentSessionView } from "$lib/server/governed-session";
import Badge from "$lib/veritio-ui/Badge.svelte";
import Button from "$lib/veritio-ui/Button.svelte";
import Card from "$lib/veritio-ui/Card.svelte";
import CardContent from "$lib/veritio-ui/CardContent.svelte";
import DispatchBadge from "./DispatchBadge.svelte";

/**
 * The agent-session capability: a trigger plus the sessions it has produced. One
 * run records a full governed AI workflow (session → prompt → tool read →
 * proposal → governed recalcs → human approval) under one session id, which the
 * Cloud projects onto its Agent Sessions, Activity Graph, and Code Changes
 * surfaces in addition to the Changes/Entities the recalcs land on. Re-authored
 * from the flagship's `AgentSessions` React section.
 */
type Props = { sessions: AgentSessionView[]; busy: boolean; onRun: () => void };
let { sessions, busy, onRun }: Props = $props();
</script>

<section class="space-y-3">
  <div class="flex items-baseline justify-between gap-3 border-b border-border pb-2">
    <div class="min-w-0">
      <h2 class="text-sm font-semibold tracking-tight text-foreground">Agent sessions</h2>
      <p class="text-[11px] text-muted-foreground">
        prompt → tool read → proposal → governed recalcs → human approval, grouped by one session id.
      </p>
    </div>
    <Button size="sm" disabled={busy} onclick={onRun}>
      {busy ? "Running session…" : "Run agent session"}
    </Button>
  </div>
  {#if sessions.length === 0}
    <Card>
      <CardContent class="p-8 text-center text-sm text-muted-foreground">
        No agent sessions yet — run one to populate the Cloud's Agent Sessions, Activity Graph, and Code Changes
        surfaces.
      </CardContent>
    </Card>
  {:else}
    <Card class="overflow-hidden">
      {#each sessions as session (session.sessionId)}
        <div
          class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
        >
          <div class="min-w-0">
            <p class="truncate font-mono text-[11px] text-muted-foreground">{session.sessionId}</p>
            <p class="truncate text-xs text-muted-foreground">{session.agentLabel} · {session.modelLabel}</p>
          </div>
          <div class="min-w-0 text-xs text-muted-foreground">
            <p class="truncate text-foreground">Recalculated {session.recalculated.length}</p>
            <p class="truncate">{session.recalculated.join(", ")}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <Badge variant="secondary" class="text-[10px] capitalize">{session.outcome}</Badge>
            <DispatchBadge dispatch={session.dispatch} />
          </div>
        </div>
      {/each}
    </Card>
  {/if}
</section>
