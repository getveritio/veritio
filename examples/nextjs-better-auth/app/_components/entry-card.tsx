"use client";

import { useState, useTransition } from "react";
import { Badge } from "../../src/veritio-ui/react/badge";
import { Button } from "../../src/veritio-ui/react/button";
import { Card, CardContent, CardHeader } from "../../src/veritio-ui/react/card";
import { Input } from "../../src/veritio-ui/react/input";
import type { EntryView, GovernedActionInput, GovernedActionResult } from "../../src/server/governed-entries";
import type { CloudPublicConfig } from "../../src/server/cloud-ingest";
import { DispatchBadge } from "./dispatch-badge";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * One governed entity card with the three real governed actions (edit, run cost
 * agent, roll back). It is a client component because the edit-form toggle and
 * rollback-target selection are local UI state — not server data, so no effect
 * is needed (rule 08). Every action is sent to the `submitGovernedAction` server
 * action, which records + dispatches on the server and revalidates `/`; the
 * server then re-renders this card with the new revision. The action result
 * drives only the transient per-card banner, kept in `useTransition` so the
 * buttons disable while the server records and the page re-reads its snapshot.
 */
export function EntryCard({
  entry,
  cloud,
  action,
}: Readonly<{
  entry: EntryView;
  cloud: CloudPublicConfig;
  action: (input: GovernedActionInput) => Promise<GovernedActionResult>;
}>) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(entry.quantity));
  const [price, setPrice] = useState(String(entry.monthlyPrice));
  const [rollbackTo, setRollbackTo] = useState("");
  const [last, setLast] = useState<GovernedActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Submits one governed action through the server action and records the result. */
  function act(input: GovernedActionInput) {
    setError(null);
    startTransition(async () => {
      try {
        setLast(await action(input));
      } catch {
        setError("The governed action failed on the server. Check the dev server logs.");
      }
    });
  }

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
              act({ kind: "update", entryId: entry.id, quantity: Number(quantity), monthlyPrice: Number(price) });
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
              <Button type="submit" size="sm" disabled={pending}>
                Save change
              </Button>
            </div>
          </form>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing((value) => !value)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => act({ kind: "agent_recalc", entryId: entry.id })}
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
                disabled={pending || !rollbackTo}
                onClick={() => act({ kind: "rollback", entryId: entry.id, rollbackToRevisionId: rollbackTo })}
              >
                Roll back
              </Button>
            </div>
          ) : null}
          {pending ? <span className="text-[11px] text-muted-foreground">working…</span> : null}
        </div>

        {last ? <LastResult result={last} cloud={cloud} /> : null}
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
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

/** Transient per-card line: what was just recorded and how it dispatched. */
function LastResult({ result, cloud }: Readonly<{ result: GovernedActionResult; cloud: CloudPublicConfig }>) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] text-foreground">
        Recorded <span className="font-medium">{result.changeType}</span> ·{" "}
        <span className="font-mono text-muted-foreground">{result.changeId}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <DispatchBadge dispatch={result.dispatch} />
        {cloud.configured && cloud.changesUrl ? (
          <a
            className="text-[11px] text-foreground underline-offset-2 hover:underline"
            href={cloud.changesUrl}
            target="_blank"
            rel="noreferrer"
          >
            View in Veritio Cloud →
          </a>
        ) : null}
        {result.dispatch.error ? (
          <span className="font-mono text-[10px] text-destructive">{result.dispatch.error}</span>
        ) : null}
      </div>
    </div>
  );
}
