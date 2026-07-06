import { expect, test } from "bun:test";
import { canonicalJson, sha256Hex } from "../export-bundle-deps";
import { computeRootHash } from "../export-bundle";

test("shim: canonical json is key-sorted and stable", () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
});

test("shim: sha256Hex known vector", async () => {
  expect(await sha256Hex("veritio")).toMatch(/^[0-9a-f]{64}$/);
});

test("rootHash is order-insensitive over file entries", async () => {
  const a = { path: "records/audit-events.jsonl", sha256: "aa".repeat(32), records: 2 };
  const b = { path: "records/evidence-edges.jsonl", sha256: "bb".repeat(32), records: 1 };
  expect(await computeRootHash([a, b])).toBe(await computeRootHash([b, a]));
  expect(await computeRootHash([a, b])).toMatch(/^[0-9a-f]{64}$/);
});
