import assert from "node:assert/strict";
import test from "node:test";
import { activeBrainRoute, brainRouteAreas } from "./brain-notice-route.mjs";

test("a player handover walks only its exact ancestry through root", () => {
  assert.deepEqual(brainRouteAreas("otto/dnd/players"), ["otto/dnd/players", "otto/dnd", "otto", "@root"]);
  assert.equal(brainRouteAreas("otto/dnd/players").includes("otto/dnd/dialogue"), false);
});

/** Builds one current brain record and matching live tmux observation. */
function fixture(overrides = {}, observed = {}) {
  const entry = { generation: 7, session: "dnd-brain-g7", instanceId: "shell-1", target: "$42" };
  const record = { area: "otto/dnd", status: "active", session: entry.session, currentAttemptId: entry.session, generation: 7, instanceId: "shell-1", generations: [entry], ...overrides };
  const inspected = { state: "live", instanceId: "shell-1", target: "$42", area: "otto/dnd", kind: "brain", generation: 7, ...observed };
  return { record, inspected };
}

test("the current generation and immutable target form one route identity", () => {
  const { record, inspected } = fixture();
  assert.deepEqual(activeBrainRoute(record, inspected, "shell-1"), {
    role: "brain", sourceArea: null, brainArea: "otto/dnd", session: "dnd-brain-g7",
    generation: 7, instanceId: "shell-1", target: "$42", brain: record,
  });
});

test("stale instances, replaced targets, and mismatched tags are fenced", () => {
  for (const observed of [{ instanceId: "old-shell" }, { target: "$41" }, { area: "otto/dnd/players" }, { kind: "worker" }, { generation: 6 }]) {
    const { record, inspected } = fixture({}, observed);
    assert.equal(activeBrainRoute(record, inspected, "shell-1"), null);
  }
  const replacement = fixture({ currentAttemptId: "dnd-brain-g8" });
  assert.equal(activeBrainRoute(replacement.record, replacement.inspected, "shell-1"), null);
});
