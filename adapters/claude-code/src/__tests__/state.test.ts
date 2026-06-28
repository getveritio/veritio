import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { clearState, loadState, saveState } from "../state";

describe("state", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "veritio-cc-state-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns a fresh empty state when none exists", () => {
    const state = loadState(dir, "sess_x");
    expect(state).toEqual({ context: null, toolSeq: 0, preImages: {}, turn: 0, activityEpisodeId: null });
  });

  test("round-trips the activity episode id across simulated process invocations", () => {
    const first = loadState(dir, "sess_1");
    first.activityEpisodeId = "ep_sess_1";
    first.toolSeq = 3;
    saveState(dir, "sess_1", first);

    const reopened = loadState(dir, "sess_1");
    expect(reopened.activityEpisodeId).toBe("ep_sess_1");
    expect(reopened.toolSeq).toBe(3);
  });

  test("round-trips across simulated process invocations", () => {
    const first = loadState(dir, "sess_1");
    first.context = { sessionId: "sess_1" } as never;
    first.toolSeq = 3;
    first.preImages["/repo/a.ts"] = "sha256:before";
    first.turn = 2;
    saveState(dir, "sess_1", first);

    const reopened = loadState(dir, "sess_1");
    expect(reopened.toolSeq).toBe(3);
    expect(reopened.turn).toBe(2);
    expect(reopened.preImages["/repo/a.ts"]).toBe("sha256:before");
    expect(reopened.context).toEqual({ sessionId: "sess_1" } as never);
  });

  test("clearState removes the session file", () => {
    saveState(dir, "sess_2", { context: null, toolSeq: 1, preImages: {}, turn: 0, activityEpisodeId: null });
    clearState(dir, "sess_2");
    expect(loadState(dir, "sess_2").toolSeq).toBe(0);
  });
});
