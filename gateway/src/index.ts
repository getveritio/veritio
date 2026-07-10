/**
 * Public surface of @veritio/gateway.
 *
 * Two integration levels: `startGateway` boots the batteries-included
 * single-container deployment (file evidence store, health loop, SIGHUP
 * reload), while `createGatewayHandler` + the pure modules let a host embed
 * the same pipeline with its own conforming evidence store. Everything
 * exported here is covered by `spec/ai-gateway-capture.md` or this
 * package's README; hosted-provider behavior is intentionally absent —
 * the OSS gateway is fully usable without any Veritio account.
 */
export {
  GatewayConfigError,
  parseGatewayConfig,
  type GatewayConfig,
  type GatewayEndpoint,
  type GatewayProvider,
  type PolicyConfig,
  type ProviderConfig,
  type VirtualKeyConfig,
} from "./config";
export {
  buildGapMarkerEvent,
  buildOutcomeEvent,
  createGatewayEvidence,
  type GatewayEvidence,
  type GatewayEvidenceConfig,
  type GatewayEvidenceSink,
  type RequestOutcome,
} from "./evidence";
export { createHealthState, type HealthState } from "./health";
export { extractPresentedKey, hashPresentedKey, resolveVirtualKey, type VirtualKeyResolution } from "./keys";
export { decide, matchesModel, type PolicyContext, type PolicyDecision, type PolicyDenyReason } from "./policy";
export {
  computeCostMicroUsd,
  parsePricingCatalog,
  PricingCatalogError,
  type ModelPrice,
  type PricingCatalog,
} from "./pricing";
export { createGatewayHandler, type GatewayHealth, type ProxyDeps } from "./proxy";
export { startGateway, type StartedGateway, type StartGatewayOptions } from "./server";
export { createSseUsageAccumulator, extractJsonUsage, type SseUsageAccumulator, type Usage } from "./usage";
