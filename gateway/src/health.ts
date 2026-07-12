/**
 * Evidence-durability health state.
 *
 * The gateway's promise is that traffic it serves is evidenced. This module
 * decides what happens when the local evidence sink fails:
 *
 * - "block" (default, fail closed): the first failed write flips `ok()`
 *   false; the proxy 503s new requests until a retry drains every pending
 *   outcome. Traffic never runs unevidenced.
 * - "degrade" (explicit operator opt-in): traffic keeps flowing; failed
 *   outcomes queue for retry, and once the sink recovers a
 *   `ai.gateway.evidence.gap` marker event records how many outcomes were
 *   dropped if the bounded queue overflowed — the gap is itself evidence.
 *
 * The pending queue is bounded (`maxPending`); overflow drops the OLDEST
 * outcome and counts it, so memory stays bounded during long sink outages.
 * Dropped counts are read non-destructively (`droppedCount`) and consumed
 * (`consumeDropped`) only after a gap marker actually recorded — consuming
 * on read would silently zero the count whenever marker emission is not yet
 * possible.
 *
 * One health state instance outlives config reloads (the failure mode is a
 * getter for that reason): pending evidence captured before a reload must
 * survive the reload, and a reload must never lift the fail-closed gate.
 */
import type { RequestOutcome } from "./evidence";

/** Health facade handed to the proxy plus the retry hooks the host drives. */
export interface HealthState {
  ok(): boolean;
  reportEvidenceFailure(outcome: RequestOutcome): void;
  reportEvidenceSuccess(): void;
  /** Drains pending outcomes through `record`; restores health when everything lands. */
  retryPending(record: (outcome: RequestOutcome) => Promise<unknown>): Promise<void>;
  pendingCount(): number;
  /** Non-destructive read of the dropped-outcome count. */
  droppedCount(): number;
  /** Subtracts `count` after a gap marker covering that many drops recorded. */
  consumeDropped(count: number): void;
}

/** Creates the process-wide health state; `mode` is read per call so config reloads apply. */
export function createHealthState(options: { mode: () => "block" | "degrade"; maxPending?: number }): HealthState {
  const maxPending = options.maxPending ?? 1000;
  const pending: RequestOutcome[] = [];
  let healthy = true;
  let dropped = 0;

  return {
    ok() {
      return options.mode() === "degrade" ? true : healthy;
    },
    reportEvidenceFailure(outcome) {
      healthy = false;
      pending.push(outcome);
      while (pending.length > maxPending) {
        pending.shift();
        dropped += 1;
      }
    },
    reportEvidenceSuccess() {
      if (pending.length === 0) healthy = true;
    },
    async retryPending(record) {
      while (pending.length > 0) {
        // Peek, don't pop: a failing retry must keep the outcome queued.
        const outcome = pending[0] as RequestOutcome;
        try {
          await record(outcome);
        } catch {
          return; // Sink still down; stay unhealthy, try again next tick.
        }
        pending.shift();
      }
      healthy = true;
    },
    pendingCount() {
      return pending.length;
    },
    droppedCount() {
      return dropped;
    },
    consumeDropped(count) {
      dropped = Math.max(0, dropped - count);
    },
  };
}
