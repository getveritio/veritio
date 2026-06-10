<script setup lang="ts">
import { ref } from "vue";

const status = ref("idle");

async function loadAuditTrail() {
  status.value = "loading";
  const response = await fetch("/api/audit");
  status.value = response.ok ? "loaded" : "failed";
}
</script>

<template>
  <main>
    <h1>Veritio Audit Trail</h1>
    <button type="button" @click="loadAuditTrail">Load reference audit trail</button>
    <p>{{ status }}</p>
  </main>
</template>
