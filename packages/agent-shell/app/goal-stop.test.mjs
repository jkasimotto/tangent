import assert from "node:assert/strict";
import test from "node:test";
import { goalStopTarget } from "./goal-stop.mjs";

test("a Goal stop resolves only the exact live session bound to that Goal", () => {
  const sessions = [
    { name: "ordinary-agent", goal: "otto/tangent/goal-ordinary.md" },
    { name: "pipeline-current", goal: "otto/tangent/goal-pipeline.md" },
    { name: "unrelated", goal: "otto/tangent/goal-other.md" },
  ];
  assert.deepEqual(goalStopTarget(sessions, { goal: "otto/tangent/goal-ordinary.md", expectedSession: "ordinary-agent" }), { status: 200, name: "ordinary-agent" });
  assert.deepEqual(goalStopTarget(sessions, { goal: "otto/tangent/goal-pipeline.md", expectedSession: "pipeline-current" }), { status: 200, name: "pipeline-current" });
  assert.equal(goalStopTarget(sessions, { goal: "otto/tangent/goal-pipeline.md", expectedSession: "unrelated" }).status, 409);
  assert.equal(goalStopTarget(sessions, { goal: "otto/tangent/goal-pipeline.md", expectedSession: "pipeline-by-slug" }).status, 409);
});

test("a Goal stop rejects missing fence fields", () => {
  assert.equal(goalStopTarget([], { goal: "otto/tangent/goal-one.md" }).status, 400);
  assert.equal(goalStopTarget([], { expectedSession: "agent" }).status, 400);
});
