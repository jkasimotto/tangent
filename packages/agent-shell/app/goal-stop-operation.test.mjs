import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGoalStopOperation } from "./goal-stop-operation.mjs";
import { createGoalStopReceipts } from "./goal-stop-receipts.mjs";

test("a Hedno Goal Stop delegates its immutable target to the shared session stop", async () => {
  const calls = [];
  const stopGoal = createGoalStopOperation({
    /** Projects the exact Hedno worker shown in Work. */
    async listSessions(options) {
      assert.deepEqual(options, { fresh: true });
      return [{
        name: "hedno-land-split-join-target-type",
        target: "$1916",
        kind: "goal",
        goal: "neara/hedno/goal-land-split-join-target-type.md",
      }];
    },
    /** Records delegation to the shared owned-session lifecycle. */
    async stopSession(name, target) {
      calls.push({ name, target });
      return { status: 200, value: { ok: true } };
    },
  });

  const result = await stopGoal({
    goal: "neara/hedno/goal-land-split-join-target-type.md",
    expectedSession: "hedno-land-split-join-target-type",
    expectedTarget: "$1916",
    operationId: "stop-hedno-1",
  });

  assert.deepEqual(result, { status: 200, value: {
    operationId: "stop-hedno-1",
    target: { kind: "goal", id: "neara/hedno/goal-land-split-join-target-type.md", tmuxTarget: "$1916" },
    state: "committed", effect: { sessionState: "absent", queueFinal: false }, retryable: false, ok: true,
  } });
  assert.deepEqual(calls, [{ name: "hedno-land-split-join-target-type", target: "$1916" }]);
  assert.deepEqual(await stopGoal({ operationId: "stop-hedno-1" }), result, "a transport retry returns the first result");
});

test("a pending Goal stop survives restart and never resolves a replacement by name", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "goal-stop-receipt-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const receipts = createGoalStopReceipts(root);
  await receipts.write({ schema: "goal-stop-operation.v1", operationId: "restart-stop", goal: "otto/goal-one.md", expectedSession: "worker", expectedTarget: "$old", state: "pending" });
  const calls = [];
  const stopGoal = createGoalStopOperation({
    receipts,
    /** Refuses any unsafe retry-time name resolution. */
    async listSessions() { throw new Error("a receipt retry must not resolve the reused name"); },
    /** Records the exact immutable target used for retry. */
    async stopSession(name, target) { calls.push({ name, target }); return { status: 200, value: { pipelineEnded: true } }; },
  });
  const result = await stopGoal({ goal: "otto/goal-one.md", expectedSession: "worker", expectedTarget: "$old", operationId: "restart-stop" });
  assert.equal(result.value.state, "committed");
  assert.deepEqual(calls, [{ name: "worker", target: "$old" }]);
  assert.equal((await receipts.read("restart-stop")).state, "complete");
});
