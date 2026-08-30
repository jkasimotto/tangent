import assert from "node:assert/strict";
import test from "node:test";
import { createGoalStopOperation } from "./goal-stop-operation.mjs";

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
  });

  assert.deepEqual(result, { status: 200, value: { ok: true } });
  assert.deepEqual(calls, [{ name: "hedno-land-split-join-target-type", target: "$1916" }]);
});
