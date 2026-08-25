import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearGoalCleanup, readAllGoalCleanups, readGoalCleanup, writeGoalCleanup } from "./goal-cleanup-record.mjs";

test("Goal cleanup errors survive retries and clear after success", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-cleanup-record-"));
  const goal = "otto/test/goal-one.md";
  try {
    const first = await writeGoalCleanup(root, goal, { targetStatus: "done", failures: [{ operation: "kill", error: "no" }] });
    const second = await writeGoalCleanup(root, goal, { targetStatus: "done", removed: ["worker"], failures: [] });
    assert.equal(first.retryCount, 1);
    assert.equal(second.retryCount, 2);
    assert.deepEqual((await readAllGoalCleanups(root)).map((record) => record.goal), [goal]);
    await clearGoalCleanup(root, goal);
    assert.equal(await readGoalCleanup(root, goal), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
