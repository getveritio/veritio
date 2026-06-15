<script lang="ts">
import type { AuditRecord } from "@veritio/core";

let status = "idle";
let records: AuditRecord[] = [];

/**
 * Records a profile-update event on the server, then refreshes the trail so the
 * new entry is visible. The browser never sends tenant or actor identity.
 */
async function recordProfileUpdate() {
  status = "recording";
  const response = await fetch("/api/profile-updates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profileId: "profile_demo" }),
  });
  if (!response.ok) {
    status = "record failed";
    return;
  }
  await loadAuditTrail();
}

async function loadAuditTrail() {
  status = "loading";
  const response = await fetch("/api/audit");
  if (!response.ok) {
    status = "load failed";
    return;
  }
  const body = (await response.json()) as { records: AuditRecord[] };
  records = body.records;
  status = `loaded ${body.records.length} record(s)`;
}
</script>

<main>
  <h1>Veritio Audit Trail</h1>
  <p>Recording happens only on the SvelteKit server; the browser calls same-origin API routes.</p>
  <button type="button" on:click={recordProfileUpdate}>Record profile update</button>
  <button type="button" on:click={loadAuditTrail}>Load audit trail</button>
  <p>{status}</p>
  <ul>
    {#each records as record (record.hash)}
      <li>{record.event.action} → {record.event.target.type}:{record.event.target.id}</li>
    {/each}
  </ul>
</main>
