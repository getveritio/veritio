import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeCostMicroUsd, parsePricingCatalog, PricingCatalogError } from "./pricing";

const packagedCatalog = JSON.parse(readFileSync(join(import.meta.dir, "..", "pricing", "catalog.json"), "utf8"));

describe("parsePricingCatalog", () => {
  test("accepts the packaged catalog", () => {
    const catalog = parsePricingCatalog(packagedCatalog);
    expect(catalog.version).toBe("2026-07-10");
    expect(catalog.models["claude-sonnet-5"]?.inputMicroUsdPerMTok).toBe(3_000_000);
  });

  test("rejects non-integer prices", () => {
    expect(() =>
      parsePricingCatalog({ version: "v", models: { m: { inputMicroUsdPerMTok: 1.5, outputMicroUsdPerMTok: 1 } } }),
    ).toThrow(PricingCatalogError);
  });

  test("rejects missing version", () => {
    expect(() => parsePricingCatalog({ models: {} })).toThrow(PricingCatalogError);
  });
});

describe("computeCostMicroUsd", () => {
  const catalog = parsePricingCatalog(packagedCatalog);

  test("integer math per direction, summed", () => {
    // claude-sonnet-5: 3_000_000 in / 15_000_000 out per MTok.
    // 412 in → round(412*3_000_000/1e6)=1236; 57 out → round(57*15_000_000/1e6)=855.
    const cost = computeCostMicroUsd({ inputTokens: 412, outputTokens: 57 }, "claude-sonnet-5", catalog);
    expect(cost).toBe(1236 + 855);
  });

  test("rounds half-up at the final division", () => {
    // 1 token at 1_500_000/MTok = 1.5 μUSD → 2 (documented half-up).
    const oneToken = parsePricingCatalog({
      version: "t",
      models: { m: { inputMicroUsdPerMTok: 1_500_000, outputMicroUsdPerMTok: 0 } },
    });
    expect(computeCostMicroUsd({ inputTokens: 1, outputTokens: 0 }, "m", oneToken)).toBe(2);
  });

  test("unknown model yields null, never a guessed cost", () => {
    expect(computeCostMicroUsd({ inputTokens: 10, outputTokens: 10 }, "unlisted-model", catalog)).toBeNull();
  });
});
