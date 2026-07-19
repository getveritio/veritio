import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditEvent, EvidenceEdge } from "@veritio/core";

import { isRetryableIngestFailure, postToIngest } from "./ingest.js";

/**
 * Offline spool for ingest ship-outs (July 2026 incident: the hosted tenant DB
 * was quota-blocked for weeks and every capture batch was silently dropped).
 * A batch that fails for a RETRYABLE reason (transport outage, 5xx, 429) is
 * written to `<localDir>/spool/` and replayed by later hook invocations once
 * the endpoint recovers. Replay is safe because record ids are deterministic
 * and server ingest is idempotent — a batch that half-landed simply replays.
 * Spooled bytes are exactly the redacted payload that would have been POSTed
 * (hashes only, redaction already ran), so nothing new lands on disk that the
 * wire would not have carried. TypeScript-only for now — a Python/Go capture
 * adapter must reproduce this ship-out behavior (parity TODO, see
 * .claude/rules/02-sdk-parity.md).
 */
export interface SpoolPayload {
  events: AuditEvent[];
  edges: EvidenceEdge[];
}

/** Hard cap on queued batches; at the cap the OLDEST batch is dropped (with a
 * stderr note) so a weeks-long outage bounds disk instead of growing forever.
 * Recent evidence wins because it is the evidence most likely to be inspected. */
export const MAX_SPOOL_BATCHES = 1_000;

/** Batches replayed per hook invocation. Small on purpose: a hook's whole
 * budget is bounded (a stalled ship-out once froze Claude Code), so drain
 * happens a little per event across the many hooks of a working session. */
export const FLUSH_BATCHES_PER_HOOK = 3;

/** Per-attempt bound during replay, tighter than the primary ship-out bound so
 * a drain of FLUSH_BATCHES_PER_HOOK batches cannot triple a hook's worst case. */
export const FLUSH_TIMEOUT_MS = 5_000;

function spoolDir(localDir: string): string {
  return join(localDir, "spool");
}

/** In-process save counter: hooks normally spool one batch per process, but a
 * same-millisecond second save (tests, future multi-batch hooks) must never
 * overwrite the first, so names carry a monotonic sequence too. */
let saveSeq = 0;

/** Lexicographically sortable name: zero-padded epoch millis, then an
 * in-process sequence, then pid (disambiguates same-millisecond hooks from
 * different processes). Name order is the replay order. */
function spoolFileName(): string {
  saveSeq += 1;
  return `${String(Date.now()).padStart(15, "0")}-${String(saveSeq).padStart(4, "0")}-${process.pid}.json`;
}

/** Queued batch file names, oldest first (name order = arrival order). */
export function listSpool(localDir: string): string[] {
  try {
    return readdirSync(spoolDir(localDir))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return []; // No spool directory yet — nothing queued.
  }
}

/**
 * Queues one failed batch, evicting oldest entries past {@link MAX_SPOOL_BATCHES}.
 * Best-effort: a spool write failure only logs — capture must never throw into
 * the hook over its own fallback.
 */
export function saveToSpool(localDir: string, payload: SpoolPayload): void {
  try {
    mkdirSync(spoolDir(localDir), { recursive: true });
    const queued = listSpool(localDir);
    for (const name of queued.slice(0, Math.max(0, queued.length + 1 - MAX_SPOOL_BATCHES))) {
      rmSync(join(spoolDir(localDir), name), { force: true });
      process.stderr.write("veritio-claude-code: spool full, dropped oldest batch\n");
    }
    writeFileSync(join(spoolDir(localDir), spoolFileName()), JSON.stringify(payload), "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`veritio-claude-code: spool write failed: ${message}\n`);
  }
}

/**
 * Replays up to `maxBatches` queued batches, oldest first. Stops at the first
 * retryable failure (the endpoint is still down — later hooks will resume) and
 * DELETES a batch on success or on a permanent rejection (a batch the server
 * refuses would poison the queue head forever; dropping it matches the
 * pre-spool behavior for that batch, with a stderr note for the operator).
 */
export async function flushSpool(
  ingest: { url: string; key: string; timeoutMs?: number },
  localDir: string,
  maxBatches = FLUSH_BATCHES_PER_HOOK,
): Promise<void> {
  for (const name of listSpool(localDir).slice(0, maxBatches)) {
    const path = join(spoolDir(localDir), name);
    let payload: SpoolPayload;
    try {
      payload = JSON.parse(readFileSync(path, "utf8")) as SpoolPayload;
    } catch {
      // Unreadable/corrupt spool entry can never replay — remove it.
      rmSync(path, { force: true });
      process.stderr.write("veritio-claude-code: dropped unreadable spool batch\n");
      continue;
    }
    try {
      await postToIngest({ ...ingest, timeoutMs: ingest.timeoutMs ?? FLUSH_TIMEOUT_MS }, payload);
    } catch (error) {
      if (isRetryableIngestFailure(error)) {
        return; // Endpoint still down; keep the queue and yield the hook budget.
      }
      rmSync(path, { force: true });
      const message = error instanceof Error ? error.message : "unknown error";
      process.stderr.write(`veritio-claude-code: spool batch permanently rejected (${message})\n`);
      continue;
    }
    rmSync(path, { force: true });
  }
}

/**
 * Ship-out entrypoint the hook uses instead of a bare postToIngest. Fast path
 * (empty spool): POST the batch, queueing it only on a retryable failure — a
 * permanent rejection is dropped exactly as before the spool existed. Backlog
 * path: the new batch is queued BEHIND the backlog and the queue drains oldest
 * first, so recovered batches reach the server in original capture order.
 */
export async function shipWithSpool(
  ingest: { url: string; key: string; timeoutMs?: number },
  localDir: string,
  payload: SpoolPayload,
): Promise<void> {
  const backlog = listSpool(localDir).length > 0;
  if (!backlog) {
    try {
      await postToIngest(ingest, payload);
    } catch (error) {
      if (isRetryableIngestFailure(error)) {
        saveToSpool(localDir, payload);
        process.stderr.write("veritio-claude-code: ingest unavailable, batch spooled for replay\n");
      } else {
        throw error; // Permanent rejection: surface exactly as before the spool.
      }
    }
    return;
  }
  if (payload.events.length > 0 || payload.edges.length > 0) {
    saveToSpool(localDir, payload);
  }
  await flushSpool(ingest, localDir);
}
