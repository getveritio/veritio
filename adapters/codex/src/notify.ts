#!/usr/bin/env bun
import { type AuditEvent, type EvidenceEdge, type RecordResult, createProvenanceRecorder } from "@veritio/core";
import { createFileEvidenceStore } from "@veritio/storage";

import { resolveConfig } from "./config.js";
import { postToIngest } from "./ingest.js";
import { type CodexNotifyPayload, buildSessionContext, promptHashOf } from "./map.js";

/**
 * Codex CLI `notify` entrypoint. Codex passes the notification JSON as a single
 * argv entry; this maps an `agent-turn-complete` notification to hash-only
 * Veritio evidence (session started + prompt hash) against a durable file store
 * (and optionally ships it to an ingest endpoint), then ALWAYS exits 0 — a
 * capture hook must never disturb or block the agent.
 *
 * Install by pointing Codex's single `notify` slot at a wrapper that both calls
 * your existing notifier AND this bin (never replace an existing notify).
 */
async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) return;

  let payload: CodexNotifyPayload;
  try {
    payload = JSON.parse(raw) as CodexNotifyPayload;
  } catch {
    return;
  }
  // Only turn-complete carries a prompt; other notification types are ignored.
  if (payload.type !== "agent-turn-complete") return;

  const config = resolveConfig(process.env);
  const recorder = createProvenanceRecorder(createFileEvidenceStore(config.localDir));
  const now = new Date().toISOString();
  const events: AuditEvent[] = [];
  const edges: EvidenceEdge[] = [];
  const collect = (result: RecordResult): void => {
    events.push(result.event.event);
    for (const edge of result.edges) {
      edges.push(edge.edge);
    }
  };

  const { session, result } = await recorder.startSession(buildSessionContext(payload, config, { now }));
  collect(result);
  collect(await session.recordPrompt({ promptHash: promptHashOf(payload), occurredAt: now }));

  if (config.ingest) {
    await postToIngest(config.ingest, { events, edges });
  }
}

main()
  .catch(() => {
    // Silent: capture never surfaces errors to Codex or the user.
  })
  .finally(() => {
    process.exit(0);
  });
