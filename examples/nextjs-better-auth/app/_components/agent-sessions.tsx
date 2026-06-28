"use client";

import { useState, useTransition } from "react";
import { Badge } from "../../src/veritio-ui/react/badge";
import { Button } from "../../src/veritio-ui/react/button";
import { Card, CardContent } from "../../src/veritio-ui/react/card";
import type { AgentSessionResult, AgentSessionView } from "../../src/server/governed-session";
import { DispatchBadge } from "./dispatch-badge";

/**
 * The agent-session capability: a trigger plus the sessions it has produced. One
 * run records a full governed AI workflow (session → prompt → tool read →
 * proposal → governed recalcs → human approval) under one session id, which the
 * Cloud projects onto its Agent Sessions, Activity Graph, and Code Changes
 * surfaces in addition to the Changes/Entities the recalcs land on.
 *
 * Client component only for the trigger: the run is an `action` server function
 * driven through `useTransition` (rule 08 — no effect; the button disables while
 * the server records and the page revalidates). The `sessions` list is read on
 * the server and rendered here as plain props.
 */
export function AgentSessions({
  sessions,
  action,
}: Readonly<{ sessions: AgentSessionView[]; action: () => Promise<AgentSessionResult> }>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Runs one agent session through the server action; the page revalidates on success. */
  function runSession() {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch {
        setError("The agent session failed on the server. Check the dev server logs.");
      }
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Agent sessions</h2>
          <p className="text-[11px] text-muted-foreground">
            prompt → tool read → proposal → governed recalcs → human approval, grouped by one activity episode.
          </p>
        </div>
        <Button size="sm" disabled={pending} onClick={runSession}>
          {pending ? "Running session…" : "Run agent session"}
        </Button>
      </div>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      {sessions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No agent sessions yet — run one to populate the Cloud’s Agent Sessions, Activity Graph, and Code Changes
            surfaces.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {sessions.map((session) => (
            <div
              key={session.activityEpisodeId}
              className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] text-foreground">{session.activityEpisodeId}</p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">{session.sessionId}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {session.agentLabel} · {session.modelLabel}
                </p>
              </div>
              <div className="min-w-0 text-xs text-muted-foreground">
                <p className="truncate text-foreground">Recalculated {session.recalculated.length}</p>
                <p className="truncate">{session.recalculated.join(", ")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {session.outcome}
                </Badge>
                <DispatchBadge dispatch={session.dispatch} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
