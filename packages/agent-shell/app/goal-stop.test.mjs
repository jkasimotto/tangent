import assert from "node:assert/strict";
import test from "node:test";
import { goalStopTarget } from "./goal-stop.mjs";

test("a Goal stop resolves only the exact live session bound to that Goal", () => {
  const sessions = [
    { name: "ordinary-agent", target: "$1", goal: "otto/tangent/goal-ordinary.md" },
    { name: "pipeline-current", target: "$2", goal: "otto/tangent/goal-pipeline.md" },
    { name: "unrelated", target: "$3", goal: "otto/tangent/goal-other.md" },
  ];
  assert.deepEqual(goalStopTarget(sessions, { goal: "otto/tangent/goal-ordinary.md", expectedSession: "ordinary-agent", expectedTarget: "$1" }), { status: 200, name: "ordinary-agent", target: "$1" });
  assert.deepEqual(goalStopTarget(sessions, { goal: "otto/tangent/goal-pipeline.md", expectedSession: "pipeline-current", expectedTarget: "$2" }), { status: 200, name: "pipeline-current", target: "$2" });
  assert.equal(goalStopTarget(sessions, { goal: "otto/tangent/goal-pipeline.md", expectedSession: "unrelated", expectedTarget: "$3" }).status, 409);
  assert.equal(goalStopTarget(sessions, { goal: "otto/tangent/goal-pipeline.md", expectedSession: "pipeline-current", expectedTarget: "$old" }).status, 200, "a stale target does not authorize the same-name replacement");
  assert.deepEqual(goalStopTarget([], { goal: "otto/tangent/goal-pipeline.md", expectedSession: "pipeline-current", expectedTarget: "$2" }), { status: 200, name: "pipeline-current", target: "$2" }, "an already-dead exact target still reaches reconciliation");
});

test("a Goal stop rejects missing fence fields", () => {
  assert.equal(goalStopTarget([], { goal: "otto/tangent/goal-one.md" }).status, 400);
  assert.equal(goalStopTarget([], { expectedSession: "agent" }).status, 400);
  assert.equal(goalStopTarget([], { goal: "otto/tangent/goal-one.md", expectedSession: "agent" }).status, 400);
});
