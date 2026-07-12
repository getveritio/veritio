/**
 * Micro-USD cost computation from provider-reported usage (pure).
 *
 * Money is integer micro-USD end to end: catalog prices are integer micro-USD
 * per one million tokens, and per-direction costs round half-up at the final
 * division so repeated computation of the same usage is byte-identical.
 * The catalog is data the process boundary loads and injects — this module
 * performs no I/O. An unknown model yields `null` (tokens are still recorded
 * in evidence; cost is omitted rather than guessed).
 */
import type { Usage } from "./usage";

/** Per-model price entry: integer micro-USD per 1,000,000 tokens. */
export interface ModelPrice {
  inputMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
}

/** Versioned price table; `version` bumps on every edit so evidence is traceable to a price set. */
export interface PricingCatalog {
  version: string;
  models: Record<string, ModelPrice>;
}

/** Typed catalog validation failure naming the offending field path. */
export class PricingCatalogError extends Error {
  readonly field: string;

  constructor(field: string, problem: string) {
    super(`invalid pricing catalog at "${field}": ${problem}`);
    this.name = "PricingCatalogError";
    this.field = field;
  }
}

function requirePriceInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PricingCatalogError(field, "expected a non-negative integer (micro-USD per 1M tokens)");
  }
  return value;
}

/**
 * Fail-closed validation of a parsed catalog JSON value. Non-integer prices
 * are rejected outright — float prices would break deterministic cost math.
 */
export function parsePricingCatalog(raw: unknown): PricingCatalog {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PricingCatalogError("$", "expected an object");
  }
  const root = raw as Record<string, unknown>;
  if (typeof root.version !== "string" || root.version.length === 0) {
    throw new PricingCatalogError("version", "expected a non-empty string");
  }
  if (typeof root.models !== "object" || root.models === null || Array.isArray(root.models)) {
    throw new PricingCatalogError("models", "expected an object");
  }
  const models: Record<string, ModelPrice> = {};
  for (const [model, value] of Object.entries(root.models as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      throw new PricingCatalogError(`models.${model}`, "expected an object");
    }
    const entry = value as Record<string, unknown>;
    models[model] = {
      inputMicroUsdPerMTok: requirePriceInteger(entry.inputMicroUsdPerMTok, `models.${model}.inputMicroUsdPerMTok`),
      outputMicroUsdPerMTok: requirePriceInteger(entry.outputMicroUsdPerMTok, `models.${model}.outputMicroUsdPerMTok`),
    };
  }
  return { version: root.version, models };
}

/**
 * Cost in integer micro-USD for one request's usage, or `null` when the
 * model is not in the catalog. Each direction rounds half-up independently
 * (`Math.round(tokens × pricePerMTok ÷ 1e6)`), then the directions sum —
 * the documented, fixture-pinned rule chargeback reports rely on.
 */
export function computeCostMicroUsd(usage: Usage, model: string, catalog: PricingCatalog): number | null {
  const price = catalog.models[model];
  if (price === undefined) return null;
  const input = Math.round((usage.inputTokens * price.inputMicroUsdPerMTok) / 1_000_000);
  const output = Math.round((usage.outputTokens * price.outputMicroUsdPerMTok) / 1_000_000);
  return input + output;
}
