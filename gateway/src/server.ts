/**
 * Process-boundary entry: the ONLY module that reads files, environment
 * variables, or process signals. It wires config → file evidence store →
 * health state → proxy handler into a Bun HTTP server, runs the pending-
 * evidence retry loop, and reloads config on SIGHUP without dropping
 * in-flight traffic. Log lines are single, sanitized, and value-free —
 * config contents include real provider keys and must never be echoed.
 *
 * Env: VERITIO_GATEWAY_CONFIG (default ./veritio-gateway.json),
 *      VERITIO_GATEWAY_PORT   (default 8790).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createFileEvidenceStore } from "@veritio/storage";
import { parseGatewayConfig, type GatewayConfig } from "./config";
import { buildGapMarkerEvent, createGatewayEvidence, type GatewayEvidence, type GatewayEvidenceSink } from "./evidence";
import { createHealthState, type HealthState } from "./health";
import { parsePricingCatalog, type PricingCatalog } from "./pricing";
import { createGatewayHandler } from "./proxy";

/** Handle returned by `startGateway`; hosts and tests drive lifecycle through it. */
export interface StartedGateway {
  port: number;
  /** Re-reads the config file; on parse failure the previous config stays active. */
  reload(): Promise<void>;
  stop(): void;
}

/** Start options; test hooks (fetchImpl, retry cadence, signal opt-out) are injectable. */
export interface StartGatewayOptions {
  configPath?: string;
  port?: number;
  fetchImpl?: typeof fetch;
  retryIntervalMs?: number;
  /** Set false in tests so the suite's own process signals stay untouched. */
  installSignalHandlers?: boolean;
}

interface Wiring {
  handler: (req: Request) => Promise<Response>;
  health: HealthState;
  evidence: GatewayEvidence;
  store: GatewayEvidenceSink;
  config: GatewayConfig;
}

/** Loads and validates config + pricing catalog from disk (fail closed on both). */
async function loadWiringInputs(configPath: string): Promise<{ config: GatewayConfig; catalog: PricingCatalog }> {
  const config = parseGatewayConfig(JSON.parse(await readFile(configPath, "utf8")));
  const catalogPath = config.pricingCatalogPath ?? join(import.meta.dir, "..", "pricing", "catalog.json");
  const catalog = parsePricingCatalog(JSON.parse(await readFile(catalogPath, "utf8")));
  return { config, catalog };
}

/**
 * Boots the gateway: one call wires storage, health, proxy, retry loop, and
 * the HTTP listener. Evidence storage is the packaged file store rooted at
 * `config.evidenceDir`; hosts needing a DB-backed store embed
 * `createGatewayHandler` directly instead of using this entry.
 */
export async function startGateway(options: StartGatewayOptions = {}): Promise<StartedGateway> {
  const configPath = options.configPath ?? process.env.VERITIO_GATEWAY_CONFIG ?? "./veritio-gateway.json";
  const port = options.port ?? Number(process.env.VERITIO_GATEWAY_PORT ?? 8790);

  /** Builds one immutable wiring generation; reload swaps the whole generation atomically. */
  async function buildWiring(): Promise<Wiring> {
    const { config, catalog } = await loadWiringInputs(configPath);
    const store = createFileEvidenceStore(config.evidenceDir);
    const evidence = createGatewayEvidence(store, { tenantId: config.tenantId, gatewayId: config.gatewayId });
    const health = createHealthState({ mode: config.evidenceFailureMode });
    const handler = createGatewayHandler({
      config,
      catalog,
      evidence,
      health,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    return { handler, health, evidence, store, config };
  }

  let current = await buildWiring();

  const retryTimer = setInterval(async () => {
    const generation = current;
    await generation.health.retryPending((outcome) => generation.evidence.record(outcome));
    const dropped = generation.health.takeDroppedCount();
    if (dropped > 0 && generation.health.pendingCount() === 0) {
      // The gap marker goes through the same chain so the outage is itself
      // evidence. Marker failure only logs: the drop count was already
      // consumed and re-queueing a marker would loop.
      try {
        await generation.store.recordEvent(
          buildGapMarkerEvent(
            { tenantId: generation.config.tenantId, gatewayId: generation.config.gatewayId },
            dropped,
          ),
        );
      } catch {
        console.error("veritio-gateway: failed to record evidence gap marker");
      }
    }
  }, options.retryIntervalMs ?? 5000);

  const server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req: Request): Promise<Response> | Response {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/healthz") {
        const healthy = current.health.ok();
        return new Response(
          JSON.stringify({
            status: healthy ? "ok" : "evidence_unavailable",
            pendingEvidence: current.health.pendingCount(),
          }),
          { status: healthy ? 200 : 503, headers: { "content-type": "application/json" } },
        );
      }
      return current.handler(req);
    },
  });

  async function reload(): Promise<void> {
    try {
      current = await buildWiring();
      console.error("veritio-gateway: config reloaded");
    } catch (error) {
      const field =
        error instanceof Error && "field" in error ? String((error as { field: unknown }).field) : "unknown";
      console.error(`veritio-gateway: config reload failed (field: ${field}); keeping previous config`);
    }
  }

  const onSighup = (): void => {
    void reload();
  };
  if (options.installSignalHandlers !== false) process.on("SIGHUP", onSighup);

  return {
    port: server.port ?? port,
    reload,
    stop() {
      clearInterval(retryTimer);
      if (options.installSignalHandlers !== false) process.off("SIGHUP", onSighup);
      server.stop(true);
    },
  };
}

// Direct execution (container entrypoint): boot and log the port only.
if (import.meta.main) {
  startGateway()
    .then((gateway) => {
      console.error(`veritio-gateway: listening on :${gateway.port}`);
    })
    .catch((error) => {
      const field =
        error instanceof Error && "field" in error ? ` (config field: ${(error as { field: unknown }).field})` : "";
      console.error(`veritio-gateway: failed to start${field}`);
      process.exit(1);
    });
}
