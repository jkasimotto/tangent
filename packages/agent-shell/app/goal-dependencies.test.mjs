import assert from "node:assert/strict";
import test from "node:test";
import { changeGoalDependencies, dependencyPromptLines, dependencySlugs, projectGoalDependencies, writeDependencySlugs } from "./goal-dependencies.mjs";

/** Builds one minimal Goal graph fixture. */
function goal(slug, dependencies = [], area = "otto/model") {
  return { slug, dependencySlugs: dependencies, area, file: `${area}/goal-${slug}.md`, title: slug, doneWhen: `${slug} done`, status: "open" };
}

test("dependency sections round-trip without changing unrelated Goal content", () => {
  const original = "---\ntype: goal\n---\n\n# Ship\n\n## State\n\nOpen.\n";
  const written = writeDependencySlugs(original, ["foundation", "api"]);
  assert.deepEqual(dependencySlugs(written), ["foundation", "api"]);
  assert.match(written, /## State\n\nOpen\./);
  assert.equal(writeDependencySlugs(written, []), original);
});

test("the projection derives forward, reverse, and unresolved references", () => {
  const goals = [goal("ship", ["api", "missing"]), goal("api")];
  projectGoalDependencies(goals);
  assert.deepEqual(goals[0].dependsOn.map((item) => item.file), ["otto/model/goal-api.md"]);
  assert.deepEqual(goals[1].requiredBy.map((item) => item.file), ["otto/model/goal-ship.md"]);
  assert.deepEqual(goals[0].unresolvedDependencies, ["missing"]);
});

test("dependency mutation is idempotent and rejects invalid graphs", () => {
  const goals = [goal("ship"), goal("api", ["schema"]), goal("schema")];
  assert.deepEqual(changeGoalDependencies(goals, "ship", ["api"]).slugs, ["api"]);
  goals[0].dependencySlugs = ["api"];
  assert.equal(changeGoalDependencies(goals, "ship", ["api"]).changed, false);
  assert.match(changeGoalDependencies(goals, "schema", ["ship"]).error, /cycle/);
  assert.match(changeGoalDependencies(goals, "ship", ["ship"]).error, /itself/);
  assert.match(changeGoalDependencies(goals, "ship", ["unknown"]).error, /no goal unknown/);
  assert.deepEqual(changeGoalDependencies(goals, "ship", ["api"], true).slugs, []);
});

test("prompt facts state dependency direction in words", () => {
  assert.deepEqual(dependencyPromptLines([goal("ship", ["api"]), goal("api")]), ["- ship depends on api."]);
});
