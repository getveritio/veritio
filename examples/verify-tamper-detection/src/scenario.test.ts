import { describe, expect, test } from "bun:test";
import { verifyEvidenceCommits } from "@veritio/core";
import {
  commitRecords,
  dropRecord,
  recordLifecycle,
  reorderRecords,
  tamperCommitManifest,
  tamperMetadata,
  verifyClean,
} from "./scenario";

describe("hash-chain verification and tamper detection", () => {
  test("an untampered export verifies end to end", async () => {
    const records = await recordLifecycle();
    expect(records).toHaveLength(3);
    expect(records[0]?.previousHash).toBeNull();
    expect(records[2]?.previousHash).toBe(records[1]?.hash ?? "");
    expect(verifyClean(records)).toEqual({ ok: true });
  });

  test("editing stored metadata fails closed with hash_mismatch at the edited index", async () => {
    const records = await recordLifecycle();
    expect(tamperMetadata(records, 1)).toEqual({ ok: false, index: 1, reason: "hash_mismatch" });
  });

  test("deleting a mid-chain record fails closed with sequence_mismatch", async () => {
    const records = await recordLifecycle();
    expect(dropRecord(records, 1)).toEqual({ ok: false, index: 1, reason: "sequence_mismatch" });
  });

  test("reordering records fails closed even though each record hash is intact", async () => {
    const records = await recordLifecycle();
    expect(reorderRecords(records)).toEqual({ ok: false, index: 1, reason: "sequence_mismatch" });
  });

  test("evidence commits verify clean and fail closed on manifest tampering", async () => {
    const records = await recordLifecycle();
    const commit = commitRecords(records);
    expect(verifyEvidenceCommits([commit])).toEqual({ ok: true });
    expect(tamperCommitManifest(commit)).toEqual({ ok: false, index: 0, reason: "records_root_mismatch" });
  });
});
