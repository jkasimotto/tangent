import assert from "node:assert/strict";
import test from "node:test";

await import("./public/tree-modes.js");

const { TREE_MODES, outcomeInFlight, modeIncludesOutcome, nearestIncludedParent } = globalThis.AgentShellTreeModes;

test("tree modes put inactive next to active in the keyboard cycle", () => {
  assert.deepEqual(TREE_MODES, ["visible", "active", "inactive", "all"]);
});

test("inactive is the complement of handed-off work", () => {
  const running = { hasSession: true, status: "open", fresh: false };
  const bound = { hasSession: false, status: "active", fresh: false };
  const available = { hasSession: false, status: "open", fresh: false };
  const waitingWithoutSession = { hasSession: false, status: "waiting", fresh: false };

  assert.equal(outcomeInFlight(running), true);
  assert.equal(outcomeInFlight(bound), true);
  assert.equal(modeIncludesOutcome("inactive", running), false);
  assert.equal(modeIncludesOutcome("inactive", bound), false);
  assert.equal(modeIncludesOutcome("inactive", available), true);
  assert.equal(modeIncludesOutcome("inactive", waitingWithoutSession), true);
});

test("a returned agent stays active and away while its session remains live", () => {
  const returned = { hasSession: true, status: "active", fresh: false };
  assert.equal(modeIncludesOutcome("active", returned), true);
  assert.equal(modeIncludesOutcome("inactive", returned), false);
});

test("fresh outcomes retain the existing active-mode escape hatch", () => {
  const fresh = { hasSession: false, status: "open", fresh: true };
  assert.equal(modeIncludesOutcome("active", fresh), true);
  assert.equal(modeIncludesOutcome("inactive", fresh), true);
});

test("inactive descendants re-root below the nearest retained ancestor", () => {
  const parents = new Map([
    ["inactive-child", "active-parent"],
    ["inactive-grandchild", "inactive-child"],
  ]);
  const included = new Set(["inactive-child", "inactive-grandchild"]);

  assert.equal(nearestIncludedParent("inactive-child", parents, included), null);
  assert.equal(nearestIncludedParent("inactive-grandchild", parents, included), "inactive-child");
});
