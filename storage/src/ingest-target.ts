import type { AuditEventInput, EvidenceEdgeInput } from "@veritio/core";
import type { OutboxAdapter, OutboxDispatcher, OutboxListOptions, OutboxPayload } from "./outbox";

/**
 * HTTP delivery of governed-change evidence to a Veritio ingest endpoint.
 *
 * This is the bridge between the local transactional outbox (`./outbox`) and the
 * hosted ingest API. The host resolves `baseUrl` + the scoped `key` at its
 * process boundary and injects them here; this module NEVER reads environment
 * variables and never embeds a key (rules 03/04). The cloud re-normalizes and
 * re-redacts every record server-side, so the draft's raw `AuditEventInput` /
 * `EvidenceEdgeInput` records are posted as-is — no local hashing.
 *
 * Delivery is idempotent: governed-change record ids are deterministic, the
 * cloud is idempotent on those ids, and a retryable failure leaves the outbox
 * row pending so the next dispatch retries safely.
 */

const DEFAULT_INGEST_PATH = "/api/ingest";

export interface IngestBatch {
  events: readonly AuditEventInput[];
  edges: readonly EvidenceEdgeInput[];
}

export interface IngestResult {
  appended: { events: number; edges: number };
  tips: { event: string | null; edge: string | null };
}

const EMPTY_RESULT: IngestResult = {
  appended: { events: 0, edges: 0 },
  tips: { event: null, edge: null },
};

/**
 * Base class for ingest delivery failures. Carries the HTTP status, an explicit
 * `retryable` flag (so a dispatcher can decide whether to keep the outbox row
 * pending), and any partial `appended` counts the server reported. Messages are
 * sanitized: raw server error text is never echoed (rule 09).
 */
export class IngestError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly appended?: { events: number; edges: number } | undefined;

  constructor(
    message: string,
    options: { status: number; retryable: boolean; appended?: { events: number; edges: number } | undefined },
  ) {
    super(message);
    this.name = "IngestError";
    this.status = options.status;
    this.retryable = options.retryable;
    this.appended = options.appended;
  }
}

/** A `5xx` ingest failure: transient, the outbox should retry. */
export class IngestRetryableError extends IngestError {
  constructor(status: number, appended?: { events: number; edges: number } | undefined) {
    super(`ingest is temporarily unavailable (status ${status})`, { status, retryable: true, appended });
    this.name = "IngestRetryableError";
  }
}

/** A `409` append/idempotency conflict: not retryable without changing inputs. */
export class IngestConflictError extends IngestError {
  constructor(appended?: { events: number; edges: number } | undefined) {
    super("ingest rejected the batch as an append conflict (status 409)", { status: 409, retryable: false, appended });
    this.name = "IngestConflictError";
  }
}

/** A `4xx` client rejection (auth, scope, validation, too-many-records). */
export class IngestClientError extends IngestError {
  constructor(status: number, appended?: { events: number; edges: number } | undefined) {
    super(`ingest rejected the batch (status ${status})`, { status, retryable: false, appended });
    this.name = "IngestClientError";
  }
}

/**
 * A server-side HTTP evidence sink. `dispatchEntry` is the real entrypoint: one
 * outbox entry becomes ONE batched POST. `postBatch` exposes the same delivery
 * for callers that already hold a `{events, edges}` batch.
 */
export interface HttpIngestTarget {
  postBatch(batch: IngestBatch): Promise<IngestResult>;
  dispatchEntry(payload: OutboxPayload): Promise<IngestResult>;
}

export interface HttpIngestTargetOptions {
  /** Cloud base URL, e.g. `https://console.getveritio.com` (host-injected). */
  baseUrl: string;
  /** `vrt_…` ingest-authority scoped key (host-injected; never logged). */
  key: string;
  /** Ingest path; defaults to `/api/ingest`. */
  path?: string;
  /** Injectable fetch for testing. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Builds an HTTP ingest target. A single governed-change draft is ~3 events plus
 * a handful of edges, so one outbox entry is always one POST. The ingest
 * endpoint owns the per-request record cap and rejects an oversized batch with a
 * typed `413` (mapped to `IngestClientError`); the client deliberately does not
 * duplicate that hosted operational limit, so the server stays the single
 * authority and the two can never silently drift.
 */
export function createHttpIngestTarget(options: HttpIngestTargetOptions): HttpIngestTarget {
  const baseUrl = requireNonEmpty(options.baseUrl, "baseUrl").replace(/\/+$/, "");
  const key = requireNonEmpty(options.key, "key");
  const path = options.path ?? DEFAULT_INGEST_PATH;
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("a fetch implementation is required (pass fetchImpl)");
  }

  /**
   * POSTs one `{events, edges}` batch and maps the response into a result or a
   * typed, sanitized error. Returns early without a network call for an empty
   * batch so dispatching an edge-only or empty entry is cheap.
   */
  async function postBatch(batch: IngestBatch): Promise<IngestResult> {
    if (batch.events.length === 0 && batch.edges.length === 0) {
      return EMPTY_RESULT;
    }

    const response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ events: batch.events, edges: batch.edges }),
    });

    const body = await safeJson(response);
    if (response.ok) {
      return parseResult(body);
    }

    const appended = extractAppended(body);
    if (response.status === 409) {
      throw new IngestConflictError(appended);
    }
    if (response.status >= 500) {
      throw new IngestRetryableError(response.status, appended);
    }
    throw new IngestClientError(response.status, appended);
  }

  return {
    postBatch,
    /**
     * Delivers one outbox payload as a single POST of its records + edges.
     */
    dispatchEntry(payload: OutboxPayload): Promise<IngestResult> {
      if (!payload || !Array.isArray(payload.records) || !Array.isArray(payload.edges)) {
        throw new TypeError("outbox payload must contain records and edges arrays");
      }
      return postBatch({ events: payload.records, edges: payload.edges });
    },
  };
}

/**
 * Drains a transactional outbox to an HTTP ingest target with ONE POST per
 * entry (rather than the per-record loop used for local sinks). On success the
 * row is marked dispatched; on any failure it is marked failed so a retryable
 * error leaves it pending for the next pass. Mirrors `createOutboxDispatcher`'s
 * batch contract but is batch-aware for the HTTP endpoint.
 */
export function createHttpOutboxDispatcher(options: {
  adapter: OutboxAdapter;
  target: Pick<HttpIngestTarget, "dispatchEntry">;
}): OutboxDispatcher {
  return {
    async dispatchBatch(listOptions: OutboxListOptions = {}) {
      let dispatched = 0;
      let failed = 0;
      const entries = await options.adapter.listDispatchable(listOptions);
      for (const entry of entries) {
        try {
          await options.target.dispatchEntry(entry.payload);
          await options.adapter.markDispatched(
            entry.id,
            listOptions.now === undefined ? {} : { dispatchedAt: listOptions.now },
          );
          dispatched += 1;
        } catch (error) {
          // Honor the typed verdict: a non-retryable rejection (4xx/409) is
          // dead-lettered so it is never re-dispatched; a transient 5xx (or any
          // unexpected non-typed throw) stays retryable rather than being
          // silently parked.
          const retryable = error instanceof IngestError ? error.retryable : true;
          await options.adapter.markFailed(entry.id, error, {
            ...(listOptions.now === undefined ? {} : { now: listOptions.now }),
            retryable,
          });
          failed += 1;
        }
      }
      return { dispatched, failed };
    },
  };
}

/**
 * Reads a JSON body defensively; a non-JSON or empty body becomes `null` rather
 * than throwing, so error mapping still depends only on the HTTP status.
 */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Coerces an ingest 200 body into the result shape, defaulting missing fields so
 * a lenient server response never crashes the dispatcher.
 */
function parseResult(body: unknown): IngestResult {
  const appended = extractAppended(body) ?? { events: 0, edges: 0 };
  const tips = isRecord(body) && isRecord(body.tips) ? body.tips : {};
  return {
    appended,
    tips: {
      event: typeof tips.event === "string" ? tips.event : null,
      edge: typeof tips.edge === "string" ? tips.edge : null,
    },
  };
}

/**
 * Extracts partial `appended` counts from an ingest response body when present,
 * so a conflict/error carries how many records the server committed.
 */
function extractAppended(body: unknown): { events: number; edges: number } | undefined {
  if (!isRecord(body) || !isRecord(body.appended)) {
    return undefined;
  }
  const { events, edges } = body.appended;
  if (typeof events === "number" && typeof edges === "number") {
    return { events, edges };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}
