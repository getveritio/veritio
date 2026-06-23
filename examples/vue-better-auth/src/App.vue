<script setup lang="ts">
import type { AuditRecord, EvidenceEdgeRecord, VerificationResult } from "@veritio/core";
import { ref } from "vue";

interface EvidenceSnapshot {
  records: AuditRecord[];
  edgeRecords: EvidenceEdgeRecord[];
  auditVerification: VerificationResult;
  edgeVerification: VerificationResult;
}

const status = ref("idle");
const records = ref<AuditRecord[]>([]);
const edgeRecords = ref<EvidenceEdgeRecord[]>([]);
const verification = ref("not checked");

/**
 * Runs create, update, and delete through the same API surface a real CRUD app
 * would expose, while the server owns tenant and actor resolution.
 */
async function runGovernedCrud() {
  status.value = "running CRUD";
  const requestId = `ref_${Date.now()}`;
  const calls = [
    ["POST", { projectId: "project_demo", name: "Governed Project", requestId: `${requestId}:create` }],
    ["PUT", { projectId: "project_demo", status: "archived", requestId: `${requestId}:update` }],
    ["DELETE", { projectId: "project_demo", requestId: `${requestId}:delete` }],
  ] as const;
  for (const [method, body] of calls) {
    const response = await fetch("/api/projects", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      status.value = `${method} failed`;
      return;
    }
  }
  await loadEvidenceTrail();
}

/**
 * Calls the server-owned evidence endpoint and renders audit and graph chains
 * without sending tenant identity from the browser.
 */
async function loadEvidenceTrail() {
  status.value = "loading";
  const response = await fetch("/api/evidence");
  if (!response.ok) {
    status.value = "load failed";
    return;
  }
  const body = (await response.json()) as EvidenceSnapshot;
  records.value = body.records;
  edgeRecords.value = body.edgeRecords;
  verification.value = `audit ${body.auditVerification.ok ? "valid" : body.auditVerification.reason}, graph ${
    body.edgeVerification.ok ? "valid" : body.edgeVerification.reason
  }`;
  status.value = `loaded ${body.records.length} event(s), ${body.edgeRecords.length} edge(s)`;
}
</script>

<template>
  <main>
    <h1>Veritio Governed CRUD</h1>
    <p>CRUD recording happens only on the Express server; the browser calls same-origin API routes.</p>
    <button type="button" @click="runGovernedCrud">Run governed CRUD</button>
    <button type="button" @click="loadEvidenceTrail">Load evidence</button>
    <p>{{ status }}</p>
    <p>{{ verification }}</p>
    <h2>Audit events</h2>
    <ul>
      <li v-for="record in records" :key="record.hash">
        {{ record.event.action }} → {{ record.event.target.type }}:{{ record.event.target.id }}
      </li>
    </ul>
    <h2>Activity graph</h2>
    <ul>
      <li v-for="record in edgeRecords" :key="record.hash">
        {{ record.edge.from.id }} {{ record.edge.relation }} {{ record.edge.to.resourceType }}:{{
          record.edge.to.id
        }}
      </li>
    </ul>
  </main>
</template>
