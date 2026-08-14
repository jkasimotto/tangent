import assert from "node:assert/strict";
import test from "node:test";
import { doneCascade } from "./goal-cascade.mjs";

/** Builds the minimal indexed-goal shape used by cascade tests. */
function goal(file, slug, subgoals = []) {
  return { file, slug, subgoals };
}

test("done cascade walks all Subgoals across home Areas", () => {
  const root = goal("otto/tangent/goal-root.md", "root", ["subgoal", "sibling"]);
  const subgoal = goal("otto/elsewhere/goal-subgoal.md", "subgoal", ["nested"]);
  const nested = goal("otto/third/goal-nested.md", "nested");
  const sibling = goal("otto/tangent/goal-sibling.md", "sibling");
  const unrelated = goal("otto/tangent/goal-unrelated.md", "unrelated");
  const indexed = new Map([root, subgoal, nested, sibling, unrelated].map((item) => [item.file, item]));

  assert.deepEqual(doneCascade(root.file, indexed).map((item) => item.file), [
    root.file,
    subgoal.file,
    nested.file,
    sibling.file,
  ]);
});

test("done cascade tolerates missing links and cycles", () => {
  const root = goal("area/goal-root.md", "root", ["subgoal", "missing"]);
  const subgoal = goal("area/goal-subgoal.md", "subgoal", ["root"]);
  const indexed = new Map([root, subgoal].map((item) => [item.file, item]));

  assert.deepEqual(doneCascade(root.file, indexed).map((item) => item.slug), ["root", "subgoal"]);
  assert.deepEqual(doneCascade("area/goal-absent.md", indexed), []);
});
