/**
 * Pure allowlist policy evaluation.
 *
 * `decide` is the single enforcement point the proxy consults before any
 * byte is forwarded upstream. It is deliberately a pure function over an
 * extensible context object so post-MVP inputs (budget state, time windows)
 * become new context fields, not a redesign. Every branch fails closed:
 * absence of a policy or an unparseable request is a deny, never a default
 * allow. Both allows and denies are recorded as evidence by the caller.
 */
import type { GatewayEndpoint, GatewayProvider, PolicyConfig } from "./config";

/** Everything the MVP policy engine is allowed to see about a request. */
export interface PolicyContext {
  keyId: string;
  provider: GatewayProvider;
  /** null when the request body could not be parsed for a model id. */
  model: string | null;
  /** null when the request path is outside the gateway's mapped endpoint set. */
  endpoint: GatewayEndpoint | null;
}

/** Machine-readable deny reasons; these flow into evidence and sanitized 403 bodies. */
export type PolicyDenyReason =
  | "missing_policy"
  | "provider_not_allowed"
  | "model_not_allowed"
  | "endpoint_not_allowed"
  | "unparseable_body";

/** Enforced decision: deny carries a reason, allow carries nothing extra. */
export type PolicyDecision = { allow: true } | { allow: false; reason: PolicyDenyReason };

/**
 * Matches a policy model pattern against a concrete model id. Patterns are
 * exact ids, trailing-`*` prefixes (`claude-sonnet-*`), or the documented
 * wildcard `"*"`. A `*` anywhere else is treated as a literal character so
 * config typos cannot silently widen an allowlist.
 */
export function matchesModel(pattern: string, model: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return model.startsWith(pattern.slice(0, -1));
  return pattern === model;
}

/**
 * Evaluates the allowlist policy for one request. Decision order (first
 * failure wins): missing policy → endpoint → provider → unparseable model →
 * model allowlist → allow. Order matters for evidence quality: an unmapped
 * endpoint is reported as such even if the model would also have failed.
 */
export function decide(ctx: PolicyContext, policy: PolicyConfig | undefined): PolicyDecision {
  if (policy === undefined) return { allow: false, reason: "missing_policy" };
  if (ctx.endpoint === null || !policy.endpoints.includes(ctx.endpoint)) {
    return { allow: false, reason: "endpoint_not_allowed" };
  }
  if (!policy.providers.includes(ctx.provider)) {
    return { allow: false, reason: "provider_not_allowed" };
  }
  if (ctx.model === null) return { allow: false, reason: "unparseable_body" };
  if (!policy.models.some((pattern) => matchesModel(pattern, ctx.model as string))) {
    return { allow: false, reason: "model_not_allowed" };
  }
  return { allow: true };
}
