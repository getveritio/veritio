/**
 * Transparent passthrough proxy handler.
 *
 * The pipeline per request: health gate → virtual-key resolution → policy
 * decision → forward to the pinned provider base URL with the real key →
 * stream the response back verbatim while observing chunks in-line (at the
 * client's pace, preserving backpressure) to extract provider-reported
 * usage → record exactly one evidence outcome.
 *
 * Invariants this module protects:
 * - Bytes pass through untouched. The single documented exception is
 *   injecting `stream_options.include_usage` into OpenAI streaming requests
 *   (config-gated, recorded as `mutatedRequest` in evidence).
 * - Real provider keys appear only in upstream request headers — never in
 *   evidence, logs, or client-facing error bodies.
 * - Fail closed: unmapped paths, unknown/revoked keys, unparseable bodies,
 *   and policy misses are denied before any upstream byte is sent.
 * - Error bodies are gateway-shaped and sanitized; unknown exception
 *   messages are never echoed to clients (rule 09).
 */
import { createHash } from "node:crypto";
import type { GatewayConfig, GatewayEndpoint, GatewayProvider } from "./config";
import type { GatewayEvidence, RequestOutcome } from "./evidence";
import { extractPresentedKey, resolveVirtualKey } from "./keys";
import { decide } from "./policy";
import { computeCostMicroUsd, type PricingCatalog } from "./pricing";
import { createSseUsageAccumulator, extractJsonUsage, type Usage } from "./usage";

/**
 * Health facade the proxy consults and reports into. In "block" mode a
 * failed evidence write flips `ok()` false and the gateway 503s new traffic
 * until the pending queue drains — running unevidenced is the one failure
 * a governance gateway must not hide.
 */
export interface GatewayHealth {
  ok(): boolean;
  reportEvidenceFailure(outcome: RequestOutcome): void;
  reportEvidenceSuccess(): void;
}

/** Dependencies injected by the process boundary (and by tests). */
export interface ProxyDeps {
  config: GatewayConfig;
  catalog: PricingCatalog;
  evidence: GatewayEvidence;
  health: GatewayHealth;
  fetchImpl?: typeof fetch;
  /** Millisecond clock, injectable for deterministic latency in tests. */
  now?: () => number;
  /** Request-id factory, injectable for deterministic evidence in tests. */
  requestIdFactory?: () => string;
  /**
   * Receives the background metering/evidence promise of streaming
   * responses so hosts can keep the process alive (and tests can await it).
   */
  waitUntil?: (work: Promise<void>) => void;
}

interface Route {
  provider: GatewayProvider;
  endpoint: GatewayEndpoint;
}

/**
 * Deny-by-default path map (spec §6): only these two provider surfaces are
 * routable in the MVP; every other path is 404 with no upstream contact.
 */
function mapRoute(method: string, pathname: string): Route | null {
  if (method !== "POST") return null;
  if (pathname === "/v1/messages") return { provider: "anthropic", endpoint: "messages" };
  if (pathname === "/v1/chat/completions") return { provider: "openai", endpoint: "chat-completions" };
  return null;
}

/** Gateway-shaped sanitized JSON error; never carries upstream or config values. */
function errorResponse(status: number, type: string, reason?: string): Response {
  return new Response(JSON.stringify({ error: { type, ...(reason === undefined ? {} : { reason }) } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Headers that must not be forwarded in either direction (RFC 9110 hop-by-hop, plus body-encoding headers fetch already consumed). */
const STRIPPED_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-encoding",
  "accept-encoding",
  "host",
  "authorization",
  "x-api-key",
]);

/** Copies client request headers, dropping hop-by-hop and credential headers. */
function forwardRequestHeaders(source: Headers, provider: GatewayProvider, apiKey: string): Headers {
  const headers = new Headers();
  source.forEach((value, name) => {
    if (!STRIPPED_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });
  if (provider === "anthropic") headers.set("x-api-key", apiKey);
  else headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

/** Copies upstream response headers, dropping hop-by-hop/encoding headers so the re-framed body stays consistent. */
function forwardResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, name) => {
    if (!STRIPPED_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });
  return headers;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Builds the fetch-compatible gateway handler. The handler owns the whole
 * request lifecycle including evidence; hosts only wire config, sinks, and
 * health state around it.
 */
export function createGatewayHandler(deps: ProxyDeps): (req: Request) => Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const nextRequestId = deps.requestIdFactory ?? (() => `req_${crypto.randomUUID()}`);
  const { config, catalog } = deps;

  /** Records one outcome, routing sink failures into health state instead of throwing. */
  async function record(outcome: RequestOutcome): Promise<void> {
    try {
      await deps.evidence.record(outcome);
      deps.health.reportEvidenceSuccess();
    } catch {
      // Sink failure detail stays out of client paths; health decides whether to block.
      deps.health.reportEvidenceFailure(outcome);
    }
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = mapRoute(req.method, url.pathname);
    if (route === null) return errorResponse(404, "not_found");
    if (!deps.health.ok()) return errorResponse(503, "evidence_unavailable");

    const startedAt = now();
    const base: Omit<RequestOutcome, "kind" | "status" | "policyDecision"> = {
      requestId: nextRequestId(),
      occurredAt: new Date(startedAt).toISOString(),
      keyId: null,
      provider: route.provider,
      endpoint: route.endpoint,
      model: null,
      stream: false,
      latencyMs: 0,
    };
    const deny = async (status: number, reason: string): Promise<Response> => {
      await record({
        ...base,
        kind: "denied",
        status,
        policyDecision: "deny",
        denyReason: reason,
        latencyMs: now() - startedAt,
      });
      const clientType = reason === "unknown_key" || reason === "revoked_key" ? reason : "policy_denied";
      return errorResponse(status, clientType, reason);
    };

    const presented = extractPresentedKey(req.headers);
    if (presented === null) return deny(401, "unknown_key");
    const resolution = resolveVirtualKey(presented, config.keys);
    if (!resolution.ok) return deny(401, resolution.reason);
    base.keyId = resolution.key.keyId;

    let bodyBytes: Uint8Array<ArrayBuffer>;
    try {
      bodyBytes = new Uint8Array(await req.arrayBuffer());
    } catch {
      // Client aborted or broke the connection mid-upload: nothing was
      // forwarded, policy never ran ("none"), still exactly one event.
      await record({
        ...base,
        kind: "failed",
        status: "aborted",
        policyDecision: "none",
        latencyMs: now() - startedAt,
      });
      return errorResponse(499, "client_aborted");
    }
    let parsedBody: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bodyBytes));
      if (typeof parsed === "object" && parsed !== null) parsedBody = parsed as Record<string, unknown>;
    } catch {
      // Unparseable body → policy denies with "unparseable_body" below.
    }
    base.model = typeof parsedBody?.model === "string" ? parsedBody.model : null;
    base.stream = parsedBody?.stream === true;
    if (config.captureContentHashes) base.requestBodyHash = sha256Hex(bodyBytes);

    const decision = decide(
      { keyId: resolution.key.keyId, provider: route.provider, model: base.model, endpoint: route.endpoint },
      config.policies[resolution.key.policy],
    );
    if (!decision.allow) return deny(403, decision.reason);

    const providerConfig = config.providers[route.provider];
    if (providerConfig === undefined) {
      // Config parsing cross-checks make this unreachable; fail closed anyway.
      return deny(503, "provider_not_configured");
    }

    let forwardBody = bodyBytes;
    if (
      route.provider === "openai" &&
      base.stream &&
      config.injectStreamUsage &&
      parsedBody !== null &&
      parsedBody.stream_options === undefined
    ) {
      base.mutatedRequest = "inject_stream_usage";
      forwardBody = new TextEncoder().encode(
        JSON.stringify({ ...parsedBody, stream_options: { include_usage: true } }),
      );
    }

    const upstreamController = new AbortController();
    req.signal.addEventListener("abort", () => upstreamController.abort());
    // The signal may have fired before the listener registered (e.g. during
    // body buffering); "abort" does not re-dispatch, so check explicitly.
    if (req.signal.aborted) upstreamController.abort();

    let upstream: Response;
    try {
      upstream = await fetchImpl(`${providerConfig.baseUrl.replace(/\/+$/, "")}${url.pathname}${url.search}`, {
        method: "POST",
        headers: forwardRequestHeaders(req.headers, route.provider, providerConfig.apiKey),
        body: forwardBody,
        signal: upstreamController.signal,
      });
    } catch {
      const aborted = req.signal.aborted;
      await record({
        ...base,
        kind: "failed",
        status: aborted ? "aborted" : 502,
        policyDecision: "allow",
        latencyMs: now() - startedAt,
      });
      return errorResponse(aborted ? 499 : 502, aborted ? "client_aborted" : "upstream_unreachable");
    }

    const responseHeaders = forwardResponseHeaders(upstream.headers);
    const isSse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");

    if (!isSse || upstream.body === null) {
      const responseBytes = new Uint8Array(await upstream.arrayBuffer());
      let usage: Usage | null = null;
      if (upstream.ok) {
        try {
          usage = extractJsonUsage(route.provider, JSON.parse(new TextDecoder().decode(responseBytes)));
        } catch {
          usage = null; // Non-JSON success body: pass through, omit usage.
        }
      }
      await record({
        ...base,
        kind: upstream.ok ? "completed" : "failed",
        status: upstream.status,
        policyDecision: "allow",
        latencyMs: now() - startedAt,
        usage,
        costMicroUsd: usage !== null && base.model !== null ? computeCostMicroUsd(usage, base.model, catalog) : null,
        ...(config.captureContentHashes ? { responseBodyHash: sha256Hex(responseBytes) } : {}),
      });
      return new Response(responseBytes, { status: upstream.status, headers: responseHeaders });
    }

    // Observed passthrough instead of tee(): chunks are hashed/metered as
    // the CLIENT pulls them, so client backpressure propagates to the
    // upstream connection and nothing buffers beyond one chunk. (A tee'd
    // meter branch reading eagerly would force the client branch's queue to
    // hold the entire un-consumed response for slow clients.)
    const accumulator = createSseUsageAccumulator(route.provider);
    const responseHash = config.captureContentHashes ? createHash("sha256") : null;
    const decoder = new TextDecoder();
    const upstreamReader = upstream.body.getReader();
    let settled = false;
    let resolveMetering: () => void = () => {};
    const meteringDone = new Promise<void>((resolve) => {
      resolveMetering = resolve;
    });
    const settle = async (outcome: RequestOutcome): Promise<void> => {
      // Exactly one outcome per request, whichever of close/error/cancel wins.
      if (settled) return;
      settled = true;
      try {
        await record(outcome);
      } finally {
        resolveMetering();
      }
    };
    const streamedOutcome = (): RequestOutcome => {
      accumulator.feed(decoder.decode());
      const usage = accumulator.usage();
      return {
        ...base,
        kind: upstream.ok ? "completed" : "failed",
        status: upstream.status,
        policyDecision: "allow",
        latencyMs: now() - startedAt,
        usage,
        costMicroUsd: usage !== null && base.model !== null ? computeCostMicroUsd(usage, base.model, catalog) : null,
        ...(responseHash === null ? {} : { responseBodyHash: responseHash.digest("hex") }),
      };
    };
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        let result: Awaited<ReturnType<typeof upstreamReader.read>>;
        try {
          result = await upstreamReader.read();
        } catch {
          controller.error(new Error("upstream stream failed"));
          await settle({
            ...base,
            kind: "failed",
            status: req.signal.aborted ? "aborted" : upstream.status,
            policyDecision: "allow",
            latencyMs: now() - startedAt,
          });
          return;
        }
        if (result.done) {
          controller.close();
          await settle(streamedOutcome());
          return;
        }
        responseHash?.update(result.value);
        accumulator.feed(decoder.decode(result.value, { stream: true }));
        controller.enqueue(result.value);
      },
      cancel: async (reason) => {
        // Client went away: release the upstream connection and evidence it.
        await upstreamReader.cancel(reason).catch(() => {});
        upstreamController.abort();
        await settle({
          ...base,
          kind: "failed",
          status: "aborted",
          policyDecision: "allow",
          latencyMs: now() - startedAt,
        });
      },
    });
    deps.waitUntil?.(meteringDone);

    return new Response(body, { status: upstream.status, headers: responseHeaders });
  };
}
