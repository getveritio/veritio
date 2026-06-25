import { Badge } from "../src/veritio-ui/react/badge";
import { Button } from "../src/veritio-ui/react/button";
import { Card, CardContent } from "../src/veritio-ui/react/card";
import { cloudStatus, listChangeFeed, listEntries } from "../src/server/governed-entries";
import { listAgentSessions } from "../src/server/governed-session";
import type { CloudPublicConfig } from "../src/server/cloud-ingest";
import type { ChangeFeedItem } from "../src/server/governed-entries";
import { runAgentSessionAction, submitGovernedAction } from "./actions/governed";
import { EntryCard } from "./_components/entry-card";
import { AgentSessions } from "./_components/agent-sessions";
import { DispatchBadge } from "./_components/dispatch-badge";

// Always re-read the in-memory governed snapshot on each request; a server
// action's revalidatePath('/') invalidates this so a recorded change shows up
// immediately on the next render.
export const dynamic = "force-dynamic";

/**
 * The flagship governed-change demo on the Next.js App Router. This is a server
 * component: it reads the current governed snapshot (entries, change feed, cloud
 * status) directly from the server-only engine — no fetch, no API route. A real
 * UI action (edit an entry, run the cost agent, roll back) is sent through the
 * `submitGovernedAction` server action, which captures it through the SDK, stages
 * it in a transactional outbox, and dispatches server-to-server to hosted Veritio
 * Cloud, then revalidates this route so the new revision renders. The browser
 * never sees the ingest key or the tenant id.
 */
export default async function HomePage() {
  const entries = listEntries();
  const feed = listChangeFeed();
  const sessions = listAgentSessions();
  const cloud = cloudStatus();

  return (
    <div className="min-h-screen bg-dotgrid">
      <Topbar cloud={cloud} />
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        <Intro cloud={cloud} />

        <section className="space-y-3">
          <SectionHeader title="Governed entities" hint="Each action below records one governed change." />
          <div className="grid gap-4 md:grid-cols-2">
            {entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} cloud={cloud} action={submitGovernedAction} />
            ))}
          </div>
        </section>

        <AgentSessions sessions={sessions} action={runAgentSessionAction} />

        <section className="space-y-3">
          <SectionHeader
            title="Recent governed changes"
            hint={
              cloud.configured
                ? "Dispatched server-to-server to Veritio Cloud."
                : "Local only — configure the cloud to dispatch."
            }
          />
          <ChangeFeed feed={feed} />
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
            Next.js App Router reference — edit → capture → outbox → hosted ingest
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
          dispatched to the hosted Cloud ingest — all inside an App Router server action. Tenant and the ingest key stay
          on the server; the browser never sees them.
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
            the Cloud console) in <code className="font-mono text-xs">.env.local</code> and restart to dispatch
            end-to-end.
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
