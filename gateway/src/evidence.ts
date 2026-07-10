/**
 * Gateway evidence construction: the `ai.*` capture vocabulary.
 *
 * Every request outcome — completed, denied, failed — becomes exactly one
 * audit event built here. This module is the privacy chokepoint: the
 * `RequestOutcome` type structurally cannot carry raw keys, headers, or
 * bodies, so nothing sensitive can reach a sink through it. Content is
 * represented only as sha256 hashes when `captureContentHashes` is on.
 * The vocabulary is normative in `spec/ai-gateway-capture.md`; core's
 * `redactMetadata` (inside `createAuditEvent`) remains the automatic
 * second net behind this module's explicit field mapping.
 */
import type { AuditEventInput, AuditRecord } from "@veritio/core";
import type { GatewayEndpoint, GatewayProvider } from "./config";
import type { Usage } from "./usage";

/**
 * The complete, sanitized description of one gateway request outcome.
 * `keyId` is null when no virtual key resolved (evidence still records the
 * attempt with actor id "unknown"). `status` is the upstream HTTP status,
 * a gateway-assigned status for local denials, or "aborted" when the client
 * cancelled mid-stream.
 */
export interface RequestOutcome {
  kind: "completed" | "denied" | "failed";
  requestId: string;
  occurredAt: string;
  keyId: string | null;
  provider: GatewayProvider;
  endpoint: GatewayEndpoint | null;
  model: string | null;
  stream: boolean;
  status: number | "aborted";
  latencyMs: number;
  policyDecision: "allow" | "deny";
  denyReason?: string;
  usage?: Usage | null;
  costMicroUsd?: number | null;
  requestBodyHash?: string;
  responseBodyHash?: string;
  mutatedRequest?: "inject_stream_usage";
}

/** Deployment identity stamped onto every gateway evidence event. */
export interface GatewayEvidenceConfig {
  tenantId: string;
  gatewayId: string;
}

/**
 * Anything that can append a gateway audit event. `FileEvidenceStore` from
 * `@veritio/storage` satisfies this directly; an `AuditRecorder` over any
 * conforming `AuditStore` adapts trivially. Host apps inject the sink —
 * the gateway never constructs storage from credentials itself.
 */
export interface GatewayEvidenceSink {
  recordEvent(input: AuditEventInput): Promise<AuditRecord>;
}

/**
 * Maps an outcome to the protocol event shape. Target is the concrete model
 * (`{type:"model", id:"anthropic:claude-…"}`) when known, else the provider,
 * so denied-before-parse requests still attribute to an upstream. Undefined
 * metadata fields are omitted (canonical JSON drops undefined) — absence
 * means "provider did not report", never zero.
 */
export function buildOutcomeEvent(outcome: RequestOutcome, cfg: GatewayEvidenceConfig): AuditEventInput {
  const metadata: Record<string, unknown> = {
    gatewayId: cfg.gatewayId,
    provider: outcome.provider,
    stream: outcome.stream,
    status: outcome.status,
    latencyMs: outcome.latencyMs,
    policyDecision: outcome.policyDecision,
  };
  if (outcome.endpoint !== null) metadata.endpoint = outcome.endpoint;
  if (outcome.model !== null) metadata.model = outcome.model;
  if (outcome.denyReason !== undefined) metadata.denyReason = outcome.denyReason;
  if (outcome.usage != null) {
    metadata.inputTokens = outcome.usage.inputTokens;
    metadata.outputTokens = outcome.usage.outputTokens;
    metadata.costBasis = "provider_reported";
  }
  if (outcome.costMicroUsd != null) metadata.costMicroUsd = outcome.costMicroUsd;
  if (outcome.requestBodyHash !== undefined) metadata.requestBodyHash = outcome.requestBodyHash;
  if (outcome.responseBodyHash !== undefined) metadata.responseBodyHash = outcome.responseBodyHash;
  if (outcome.mutatedRequest !== undefined) metadata.mutatedRequest = outcome.mutatedRequest;

  return {
    action: `ai.request.${outcome.kind}`,
    actor: { type: "service", id: outcome.keyId ?? "unknown" },
    target:
      outcome.model !== null
        ? { type: "model", id: `${outcome.provider}:${outcome.model}` }
        : { type: "provider", id: outcome.provider },
    requestId: outcome.requestId,
    occurredAt: outcome.occurredAt,
    scope: { tenantId: cfg.tenantId },
    metadata,
  };
}

/** Recorder facade the proxy uses; one call per request outcome. */
export interface GatewayEvidence {
  record(outcome: RequestOutcome): Promise<AuditRecord>;
}

/**
 * Binds the outcome→event mapping to a sink. Kept as a factory so the proxy
 * depends on the narrow `GatewayEvidence` facade and tests can substitute a
 * failing sink to exercise the fail-closed health path.
 */
export function createGatewayEvidence(sink: GatewayEvidenceSink, cfg: GatewayEvidenceConfig): GatewayEvidence {
  return {
    record(outcome) {
      return sink.recordEvent(buildOutcomeEvent(outcome, cfg));
    },
  };
}
