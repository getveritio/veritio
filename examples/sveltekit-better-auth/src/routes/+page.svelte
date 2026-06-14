<script lang="ts">
  let status = "idle";

  async function loadAuditTrail() {
    status = "loading";
    const response = await fetch("/api/audit");
    status = response.ok ? "loaded" : "failed";
  }
</script>

<main>
  <h1>Veritio Audit Trail</h1>
  <button type="button" on:click={loadAuditTrail}>Load reference audit trail</button>
  <p>{status}</p>
</main>
