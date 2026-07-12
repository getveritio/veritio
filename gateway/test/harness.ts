/**
 * Shared proxy test harness: in-memory evidence sink, permissive health
 * stub, deterministic clock/request ids, and a recording fake fetch. Lives
 * under `test/` (with the fixtures) so it stays outside the tsc build and
 * outside bun's test-file discovery.
 */
import type { AuditEventInput, AuditRecord } from "@veritio/core";
import type { GatewayConfig } from "../src/config";
import { createGatewayEvidence, type GatewayEvidence, type RequestOutcome } from "../src/evidence";
import { hashPresentedKey } from "../src/keys";
import { parsePricingCatalog, type PricingCatalog } from "../src/pricing";
import { createGatewayHandler, type GatewayHealth, type ProxyDeps } from "../src/proxy";

export const PRESENTED_KEY = "vk_marketing_prod_0123456789abcdef";
export const PROVIDER_KEY_ANTHROPIC = "sk-ant-real-provider-key";
export const PROVIDER_KEY_OPENAI = "sk-openai-real-provider-key";

export const TEST_CATALOG: PricingCatalog = parsePricingCatalog({
  version: "test",
  models: {
    "claude-sonnet-5": { inputMicroUsdPerMTok: 3_000_000, outputMicroUsdPerMTok: 15_000_000 },
    "gpt-5.2": { inputMicroUsdPerMTok: 1_250_000, outputMicroUsdPerMTok: 10_000_000 },
  },
});

/** Baseline config: one anthropic-only policy plus an openai-capable one. */
export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    tenantId: "tenant_test",
    gatewayId: "gw_test",
    evidenceDir: "/unused-in-tests",
    evidenceFailureMode: "block",
    captureContentHashes: true,
    injectStreamUsage: true,
    providers: {
      anthropic: { baseUrl: "https://anthropic.upstream.test", apiKey: PROVIDER_KEY_ANTHROPIC },
      openai: { baseUrl: "https://openai.upstream.test", apiKey: PROVIDER_KEY_OPENAI },
    },
    policies: {
      default: { providers: ["anthropic"], models: ["claude-sonnet-*"], endpoints: ["messages"] },
      openai: { providers: ["openai"], models: ["gpt-5.2"], endpoints: ["chat-completions"] },
    },
    keys: [{ keyId: "vk_marketing_prod", keyHash: hashPresentedKey(PRESENTED_KEY), policy: "default" }],
    ...overrides,
  };
}

/** In-memory evidence sink capturing every event input for assertions. */
export function memoryEvidence(cfg: { tenantId: string; gatewayId: string }): {
  evidence: GatewayEvidence;
  events: AuditEventInput[];
} {
  const events: AuditEventInput[] = [];
  const evidence = createGatewayEvidence(
    {
      recordEvent(input) {
        events.push(input);
        return Promise.resolve({ event: input } as unknown as AuditRecord);
      },
    },
    cfg,
  );
  return { evidence, events };
}

/** Health stub tracking reports; always healthy unless told otherwise. */
export function stubHealth(): GatewayHealth & { failures: RequestOutcome[]; healthy: boolean } {
  const state = {
    healthy: true,
    failures: [] as RequestOutcome[],
    ok(): boolean {
      return state.healthy;
    },
    reportEvidenceFailure(outcome: RequestOutcome): void {
      state.failures.push(outcome);
    },
    reportEvidenceSuccess(): void {},
  };
  return state;
}

export interface FakeUpstreamCall {
  url: string;
  headers: Headers;
  bodyText: string;
  signal: AbortSignal | null | undefined;
}

/** Recording fake fetch returning a canned or computed response. */
export function fakeFetch(respond: (call: FakeUpstreamCall) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: FakeUpstreamCall[];
} {
  const calls: FakeUpstreamCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FakeUpstreamCall = {
      url: String(input),
      headers: new Headers(init?.headers),
      bodyText: init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init?.body ?? ""),
      signal: init?.signal,
    };
    calls.push(call);
    if (call.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return respond(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export interface HarnessOptions {
  config?: GatewayConfig;
  respond?: (call: FakeUpstreamCall) => Response | Promise<Response>;
  evidence?: GatewayEvidence;
}

/** Assembles handler + spies with deterministic clock and request ids. */
export function harness(options: HarnessOptions = {}) {
  const config = options.config ?? testConfig();
  const recorded = memoryEvidence({ tenantId: config.tenantId, gatewayId: config.gatewayId });
  const health = stubHealth();
  const upstream = fakeFetch(
    options.respond ??
      (() =>
        new Response(JSON.stringify({ id: "msg", usage: { input_tokens: 412, output_tokens: 57 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })),
  );
  let requestCounter = 0;
  const pending: Promise<void>[] = [];
  const deps: ProxyDeps = {
    config,
    catalog: TEST_CATALOG,
    evidence: options.evidence ?? recorded.evidence,
    health,
    fetchImpl: upstream.fetchImpl,
    now: () => 1_000,
    requestIdFactory: () => `req_${++requestCounter}`,
    waitUntil: (work) => pending.push(work),
  };
  return {
    handle: createGatewayHandler(deps),
    events: recorded.events,
    health,
    calls: upstream.calls,
    /** Awaits background streaming metering so assertions are deterministic. */
    settle: async () => {
      await Promise.all(pending);
    },
  };
}

/** Convenience request builder for the Anthropic surface. */
export function anthropicRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://gateway.test/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": PRESENTED_KEY, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
