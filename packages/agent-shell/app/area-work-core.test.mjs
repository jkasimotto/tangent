import assert from "node:assert/strict";
import test from "node:test";
import core from "./public/area-work-core.js";

/** Creates one projected Goal for graph fixtures. */
const goal = (file, title, area, assignees = [], dependsOn = []) => ({
  file, title, area, assignees, assigneeKeys: assignees.map((name) => `${area}::${name.toLowerCase()}`),
  status: "open", dependsOn, requiredBy: [], changedAt: 1,
});

test("the Work graph keeps a person filter's prerequisite context", () => {
  const troyA = goal("neara/pgande/benchmarking/goal-a.md", "PLDB mismatch", "neara/pgande/benchmarking", ["Troy"]);
  const troyB = goal("neara/pgande/benchmarking/goal-b.md", "Force difference", "neara/pgande/benchmarking", ["Troy"]);
  const rit = goal("neara/pgande/benchmarking/goal-c.md", "Benchmark poles", "neara/pgande/benchmarking", ["Rit"], [
    { file: troyA.file, title: troyA.title, status: "open" }, { file: troyB.file, title: troyB.title, status: "open" },
  ]);
  const result = core.project({ scope: "neara/pgande/benchmarking", goals: [troyA, troyB, rit], areaPaths: [], filters: { person: "neara/pgande/benchmarking::rit" } });
  assert.equal(result.matchCount, 1);
  assert.deepEqual(result.frontier.map((item) => [item.goal.title, item.kind]), [["PLDB mismatch", "context"], ["Force difference", "context"], ["Benchmark poles", "goal"]]);
  assert.equal(result.frontier.at(-1).fact.kind, "blocked");
});

test("the first view caps a hundred ready Goals at twelve", () => {
  const goals = Array.from({ length: 100 }, (_, index) => goal(`otto/team/goal-${index}.md`, `Goal ${String(index).padStart(3, "0")}`, "otto/team"));
  const result = core.project({ scope: "otto/team", goals, areaPaths: [] });
  assert.equal(result.readyCount, 100);
  assert.equal(result.frontier.length, 12);
  assert.equal(result.frontierHidden, 88);
});

test("direct child Areas stay portals until entered", () => {
  const nested = goal("otto/team/child/deep/goal-work.md", "Nested work", "otto/team/child/deep");
  const result = core.project({ scope: "otto/team", goals: [nested], areaPaths: ["otto/team", "otto/team/child", "otto/team/child/deep"] });
  assert.equal(result.frontier.length, 1);
  assert.deepEqual(result.frontier[0], { kind: "portal", path: "otto/team/child", title: "child", openCount: 1, readyCount: 1, preview: nested });
});

test("dropped and unresolved prerequisites never make a Goal ready", () => {
  const broken = goal("otto/team/goal-broken.md", "Broken", "otto/team", [], [{ file: "otto/team/goal-old.md", title: "Old", status: "dropped" }]);
  const unknown = { ...goal("otto/team/goal-unknown.md", "Unknown", "otto/team"), unresolvedDependencies: ["missing"] };
  assert.equal(core.readiness(broken, new Map()).kind, "broken");
  assert.equal(core.readiness(unknown, new Map()).kind, "error");
});
