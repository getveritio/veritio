<script setup lang="ts">
import type { AuditRecord } from "@veritio/core";
import { ref } from "vue";

const status = ref("idle");
const records = ref<AuditRecord[]>([]);

/**
 * Records a profile-update event via the server, then refreshes the trail so the
 * new entry is visible. The browser never sends tenant or actor identity.
 */
async function recordProfileUpdate() {
  status.value = "recording";
  const response = await fetch("/api/profile-updates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profileId: "profile_demo", requestId: `ref_${Date.now()}` }),
  });
  if (!response.ok) {
    status.value = "record failed";
    return;
  }
  await loadAuditTrail();
}

/**
 * Calls the server-owned audit endpoint and renders the returned records without
 * sending tenant identity from the browser.
 */
async function loadAuditTrail() {
  status.value = "loading";
  const response = await fetch("/api/audit");
  if (!response.ok) {
    status.value = "load failed";
    return;
  }
  const body = (await response.json()) as { records: AuditRecord[] };
  records.value = body.records;
  status.value = `loaded ${body.records.length} record(s)`;
}
</script>

<template>
  <main>
    <h1>Veritio Audit Trail</h1>
    <p>Recording happens only on the Express server; the browser calls same-origin API routes.</p>
    <button type="button" @click="recordProfileUpdate">Record profile update</button>
    <button type="button" @click="loadAuditTrail">Load audit trail</button>
    <p>{{ status }}</p>
    <ul>
      <li v-for="record in records" :key="record.hash">
        {{ record.event.action }} → {{ record.event.target.type }}:{{ record.event.target.id }}
      </li>
    </ul>
  </main>
</template>
