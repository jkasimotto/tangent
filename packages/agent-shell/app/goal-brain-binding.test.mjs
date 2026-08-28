import assert from "node:assert/strict";
import test from "node:test";
import { withoutBrainGoalBinding, withoutBrainGoalBindings } from "./goal-brain-binding.mjs";

test("Goal projection quarantines brain bindings and preserves worker bindings", () => {
  const brains = new Set(["tangent-brain", "tangent-brain-g2"]);
  const contaminated = withoutBrainGoalBinding({ status: "active", session: "tangent-brain" }, brains);
  assert.deepEqual(contaminated, { status: "open", session: null, brainSessionBinding: "tangent-brain" });
  const worker = { status: "active", session: "goal-worker" };
  assert.equal(withoutBrainGoalBinding(worker, brains), worker);
});

test("cached vault projection removes a brain from every Goal copy", () => {
  const goal = { file: "otto/tangent/goal-proof.md", status: "active", session: "tangent-brain-g2" };
  const vault = { areas: [{ path: "otto/tangent", goals: [goal] }], map: [{ path: "otto/tangent", goals: [goal] }] };
  const projected = withoutBrainGoalBindings(vault, new Set(["tangent-brain-g2"]));
  assert.equal(projected.areas[0].goals[0].session, null);
  assert.equal(projected.map[0].goals[0].status, "open");
  assert.equal(vault.areas[0].goals[0].session, "tangent-brain-g2", "projection does not mutate the cache");
});
