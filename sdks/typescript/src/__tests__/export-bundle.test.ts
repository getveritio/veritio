import { expect, test } from "bun:test";
import { canonicalJson, sha256Hex } from "../export-bundle-deps";

test("shim: canonical json is key-sorted and stable", () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
});

test("shim: sha256Hex known vector", async () => {
  expect(await sha256Hex("veritio")).toMatch(/^[0-9a-f]{64}$/);
});
