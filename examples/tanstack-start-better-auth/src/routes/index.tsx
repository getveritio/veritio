import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getGovernedSnapshot, runAgentSessionFn, runGovernedActionFn } from "@/server/actions";
import type { CloudPublicConfig } from "@/server/cloud-ingest";
import type { ChangeFeedItem, EntryView, GovernedActionInput, GovernedActionResult } from "@/server/governed-entries";
import type { AgentSessionView } from "@/server/governed-session";
import { Badge } from "@/veritio-ui/react/badge";
import { Button } from "@/veritio-ui/react/button";
import { Card, CardContent, CardHeader } from "@/veritio-ui/react/card";
import { Input } from "@/veritio-ui/react/input";

export const Route = createFileRoute("/")({
  loader: () => getGovernedSnapshot(),
  component: Home,
});

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * The flagship governed-change demo: a real UI action (edit an entry, run the
 * cost agent, roll back) becomes a governed Change that is captured through the
 * SDK, staged in a transactional outbox, and dispatched server-to-server to the
 * hosted Veritio Cloud — where it appears live on the Changes / Entities
 * surfaces. The browser never sees the ingest key or the tenant; the loader and
 * server functions own all of it.
 */
function Home() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [last, setLast] = useState<GovernedActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);

  async function act(input: GovernedActionInput) {
    setBusyId(input.entryId);
    setError(null);
    try {
      const result = await runGovernedActionFn({ data: input });
      setLast(result);
      await router.invalidate();
    } catch {
      setError("The governed action failed on the server. Check the dev server logs.");
    } finally {
      setBusyId(null);
    }
  }

  async function runSession() {
    setSessionBusy(true);
    setError(null);
    try {
      await runAgentSessionFn();
      await router.invalidate();
    } catch {
      setError("The agent session failed on the server. Check the dev server logs.");
    } finally {
      setSessionBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-dotgrid">
      <Topbar cloud={data.cloud} />
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        <Intro cloud={data.cloud} />
        {last ? <ActionResultBanner result={last} onDismiss={() => setLast(null)} /> : null}
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <section className="space-y-3">
          <SectionHeader title="Governed entities" hint="Each action below records one governed change." />
          <div className="grid gap-4 md:grid-cols-2">
            {data.entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} busy={busyId === entry.id} onAction={act} />
            ))}
          </div>
        </section>

        <AgentSessions sessions={data.sessions} busy={sessionBusy} onRun={runSession} />

        <section className="space-y-3">
          <SectionHeader
            title="Recent governed changes"
            hint={
              data.cloud.configured
                ? "Dispatched server-to-server to Veritio Cloud."
                : "Local only — configure the cloud to dispatch."
            }
          />
          <ChangeFeed feed={data.feed} />
        </section>
      </main>
    </div>
  );
}

/** Sticky topbar mirroring the Cloud's chrome: brand, cloud status, deep link. */
function Topbar({ cloud }: Readonly<{ cloud: CloudPublicConfig }>) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
        <span className="size-2.5 rounded-full bg-success" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">Veritio · Governed changes</p>
          <p className="truncate text-[11px] text-muted-foreground">
            TanStack Start reference — edit → capture → outbox → hosted ingest
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {cloud.configured ? (
            <Badge variant="success" className="font-mono text-[10px]">
              Cloud · {cloud.projectId?.slice(0, 8)}…
            </Badge>
          ) : (
            <Badge variant="muted" className="text-[10px]">
              Local only
            </Badge>
          )}
          {cloud.configured && cloud.changesUrl ? (
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={cloud.changesUrl} target="_blank" rel="noreferrer">
                View in Veritio Cloud
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Explains the loop, and how to point the example at a hosted Cloud project. */
function Intro({ cloud }: Readonly<{ cloud: CloudPublicConfig }>) {
  return (
    <Card className="bg-card/60">
      <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
        <p className="text-foreground">
          A real UI action becomes a governed <span className="font-medium">Change</span>: captured by{" "}
          <code className="font-mono text-xs">createGovernedChangeDraft</code>, staged in a transactional outbox, and
          dispatched to the hosted Cloud ingest. Tenant and the ingest key stay server-side; the browser never sees
          them.
        </p>
        {cloud.configured ? (
          <p>
            Dispatching to <span className="font-mono text-xs text-foreground">{cloud.baseUrl}</span> · project{" "}
            <span className="font-mono text-xs text-foreground">{cloud.projectId}</span>. Open the Cloud → Evidence →
            Changes to watch entries land.
          </p>
        ) : (
          <p>
            Running <span className="font-medium text-foreground">local-only</span>. Set{" "}
            <code className="font-mono text-xs">VERITIO_CLOUD_BASE_URL</code>,{" "}
            <code className="font-mono text-xs">VERITIO_CLOUD_PROJECT_ID</code>, and{" "}
            <code className="font-mono text-xs">VERITIO_CLOUD_INGEST_TOKEN</code> (an <em>ingest</em> scoped key from
            the Cloud console) and restart to dispatch end-to-end.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title, hint }: Readonly<{ title: string; hint: string }>) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The agent-session capability: a trigger plus the sessions it has produced. One
 * run records a full governed AI workflow (session → prompt → tool read →
 * proposal → governed recalcs → human approval) under one session id, which the
 * Cloud projects onto its Agent Sessions, Activity Graph, and Code Changes
 * surfaces in addition to the Changes/Entities the recalcs land on.
 */
function AgentSessions({
  sessions,
  busy,
  onRun,
}: Readonly<{ sessions: AgentSessionView[]; busy: boolean; onRun: () => void }>) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Agent sessions</h2>
          <p className="text-[11px] text-muted-foreground">
            prompt → tool read → proposal → governed recalcs → human approval, grouped by one activity episode.
          </p>
        </div>
        <Button size="sm" disabled={busy} onClick={onRun}>
          {busy ? "Running session…" : "Run agent session"}
        </Button>
      </div>
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

/** One governed entity: current state plus the three real governed actions. */
function EntryCard({
  entry,
  busy,
  onAction,
}: Readonly<{ entry: EntryView; busy: boolean; onAction: (input: GovernedActionInput) => void }>) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(entry.quantity));
  const [price, setPrice] = useState(String(entry.monthlyPrice));
  const [rollbackTo, setRollbackTo] = useState("");

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{entry.name}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{entry.id}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant={entry.status === "active" ? "secondary" : "warning"} className="text-[10px] uppercase">
            {entry.status}
          </Badge>
          <Badge variant="muted" className="font-mono text-[10px]">
            v{entry.version}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Field label="Quantity" value={String(entry.quantity)} />
          <Field label="Monthly price" value={usd.format(entry.monthlyPrice)} />
          <Field label="Customer" value={entry.customerEmail} hint="keyed digest in evidence" />
          <Field label="Revisions" value={String(entry.revisions.length)} />
        </dl>

        {editing ? (
          <form
            className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/20 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              setEditing(false);
              onAction({
                kind: "update",
                entryId: entry.id,
                quantity: Number(quantity),
                monthlyPrice: Number(price),
              });
            }}
          >
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Quantity</span>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Monthly price</span>
              <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <div className="col-span-2 flex justify-end gap-2 pt-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                Save change
              </Button>
            </div>
          </form>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing((value) => !value)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAction({ kind: "agent_recalc", entryId: entry.id })}
          >
            Run cost agent
          </Button>
          {entry.revisions.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Roll back to revision"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                value={rollbackTo}
                onChange={(e) => setRollbackTo(e.target.value)}
              >
                <option value="">Roll back to…</option>
                {entry.revisions.map((rev) => (
                  <option key={rev.revisionId} value={rev.revisionId}>
                    v{rev.version} · {usd.format(rev.monthlyPrice)}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !rollbackTo}
                onClick={() => onAction({ kind: "rollback", entryId: entry.id, rollbackToRevisionId: rollbackTo })}
              >
                Roll back
              </Button>
            </div>
          ) : null}
          {busy ? <span className="text-[11px] text-muted-foreground">working…</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, hint }: Readonly<{ label: string; value: string; hint?: string }>) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground" title={value}>
        {value}
      </dd>
      {hint ? <dd className="truncate text-[10px] text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** Transient banner showing the most recent change + its dispatch outcome. */
function ActionResultBanner({ result, onDismiss }: Readonly<{ result: GovernedActionResult; onDismiss: () => void }>) {
  const { dispatch } = result;
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-foreground">
          Recorded <span className="font-medium">{result.changeType}</span> ·{" "}
          <span className="font-mono text-xs text-muted-foreground">{result.changeId}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <DispatchBadge dispatch={dispatch} />
          {result.cloud.configured && result.cloud.changesUrl ? (
            <a
              className="text-xs text-foreground underline-offset-2 hover:underline"
              href={result.cloud.changesUrl}
              target="_blank"
              rel="noreferrer"
            >
              View in Veritio Cloud →
            </a>
          ) : null}
          {dispatch.error ? <span className="font-mono text-[11px] text-destructive">{dispatch.error}</span> : null}
        </div>
      </div>
      <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </Button>
    </div>
  );
}

/** The recent governed-change feed with per-change dispatch status. */
function ChangeFeed({ feed }: Readonly<{ feed: ChangeFeedItem[] }>) {
  if (feed.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No governed changes yet — edit an entry, run the cost agent, or roll back to record the first one.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      {feed.map((item) => (
        <div
          key={item.changeId}
          className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{item.changeType}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{item.changeId}</p>
          </div>
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="truncate">{item.entryName}</p>
            <p className="truncate">{item.actorLabel}</p>
          </div>
          <DispatchBadge dispatch={item.dispatch} />
        </div>
      ))}
    </Card>
  );
}

/** Honest dispatch status: dispatched (emerald), failed, or local-only. */
function DispatchBadge({ dispatch }: Readonly<{ dispatch: GovernedActionResult["dispatch"] }>) {
  if (dispatch.status === "dispatched") {
    return (
      <Badge variant="success" className="text-[10px]">
        Dispatched to Cloud
      </Badge>
    );
  }
  if (dispatch.status === "failed") {
    return (
      <Badge variant="warning" className="text-[10px]">
        Dispatch failed · retrying
      </Badge>
    );
  }
  return (
    <Badge variant="muted" className="text-[10px]">
      Captured locally
    </Badge>
  );
}
