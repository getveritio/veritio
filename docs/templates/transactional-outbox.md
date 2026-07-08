# Transactional Outbox Template

Use a transactional outbox when the application mutation and Veritio evidence
must recover together. The host application owns this table/collection. Hosted
ingest, local file delivery, or another worker can consume it later.

## Minimal Shape

```sql
create table veritio_outbox (
  id text primary key,
  tenant_id text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  payload_json text not null,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);
```

`payload_json` should store the governed action draft's `outboxEntry` as
canonical JSON or another byte-stable string format chosen by the host app.

## Write Path

```ts
const draft = createGovernedActionDraft(input);

await db.transaction(async (tx) => {
  await tx.projectEntry.update(after);
  await tx.veritioOutbox.insert({
    id: draft.changeRef.id,
    tenantId: input.scope.tenantId,
    status: "pending",
    payloadJson: JSON.stringify(draft.outboxEntry),
  });
});
```

## Dispatch Path

```ts
for (const row of await db.veritioOutbox.claimPending({ limit: 50 })) {
  try {
    const outboxEntry = JSON.parse(row.payloadJson);
    await localEvidenceStore.appendOutboxEntry(outboxEntry);
    await db.veritioOutbox.markDispatched(row.id);
  } catch (error) {
    await db.veritioOutbox.markRetry(row.id, { error: String(error) });
  }
}
```

Hosted delivery is the same server-side dispatch shape with a different
injected target. Do not put hosted API keys, hosted project ids, or tenant
authority decisions in browser code.
