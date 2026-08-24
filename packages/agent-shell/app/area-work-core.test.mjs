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
  assert.deepEqual(result.frontier.map((item) => [item.goal.title, item.kind]), [["Force difference", "context"], ["PLDB mismatch", "context"], ["Benchmark poles", "goal"]]);
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
  assert.deepEqual(result.frontier[0], { kind: "portal", path: "otto/team/child", title: "child", openCount: 1, readyCount: 1, preview: nested, dependencyCount: 0 });
});

test("a deep chain expands one dependency step at a time", () => {
  const first = goal("otto/team/goal-a.md", "A", "otto/team");
  const second = goal("otto/team/goal-b.md", "B", "otto/team", [], [{ file: first.file, title: first.title, status: "open" }]);
  const third = goal("otto/team/goal-c.md", "C", "otto/team", [], [{ file: second.file, title: second.title, status: "open" }]);
  const firstView = core.project({ scope: "otto/team", goals: [first, second, third], areaPaths: [] });
  assert.deepEqual(firstView.successors.map((item) => item.goal.title), ["B"]);
  assert.equal(firstView.deeperSuccessors, true);
  const expanded = core.project({ scope: "otto/team", goals: [first, second, third], areaPaths: [], limits: { successorDepth: 2 } });
  assert.deepEqual(expanded.successors.map((item) => item.goal.title), ["B", "C"]);
});

test("cross-Area dependencies stay counted at portals and expose boundary Goals", () => {
  const source = goal("otto/team/a/goal-source.md", "Source", "otto/team/a");
  const target = goal("otto/team/b/goal-target.md", "Target", "otto/team/b", [], [{ file: source.file, title: source.title, status: "open" }]);
  const result = core.project({ scope: "otto/team", goals: [source, target], areaPaths: ["otto/team/a", "otto/team/b"] });
  assert.equal(result.boundaryEdges.length, 1);
  assert.deepEqual(result.frontier.map((item) => [item.path, item.dependencyCount]), [["otto/team/a", 1], ["otto/team/b", 1]]);
});

test("cross-Area boundary details use the same twelve-item disclosure limit", () => {
  const sources = Array.from({ length: 20 }, (_, index) => goal(`otto/team/a/goal-${index}.md`, `Source ${index}`, "otto/team/a"));
  const targets = sources.map((source, index) => goal(`otto/team/b/goal-${index}.md`, `Target ${index}`, "otto/team/b", [], [{ file: source.file, title: source.title, status: "open" }]));
  const result = core.project({ scope: "otto/team", goals: [...sources, ...targets], areaPaths: ["otto/team/a", "otto/team/b"] });
  assert.equal(result.boundaryEdges.length, 12);
  assert.equal(result.boundaryHidden, 8);
});

test("cycles and zero-ready graphs explain why no Goal is ready", () => {
  const a = goal("otto/team/goal-a.md", "A", "otto/team");
  const b = goal("otto/team/goal-b.md", "B", "otto/team");
  a.dependsOn = [{ file: b.file, title: b.title, status: "open" }];
  b.dependsOn = [{ file: a.file, title: a.title, status: "open" }];
  const result = core.project({ scope: "otto/team", goals: [a, b], areaPaths: [] });
  assert.deepEqual([...core.cycleFiles([a, b])].sort(), [a.file, b.file]);
  assert.match(result.emptyReason, /dependency graph has an error/);
});

test("dropped and unresolved prerequisites never make a Goal ready", () => {
  const broken = goal("otto/team/goal-broken.md", "Broken", "otto/team", [], [{ file: "otto/team/goal-old.md", title: "Old", status: "dropped" }]);
  const unknown = { ...goal("otto/team/goal-unknown.md", "Unknown", "otto/team"), unresolvedDependencies: ["missing"] };
  assert.equal(core.readiness(broken, new Map()).kind, "broken");
  assert.equal(core.readiness(unknown, new Map()).kind, "error");
});
