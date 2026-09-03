import { strict as assert } from "node:assert";
import { test } from "node:test";
import { flattenTree, treeRovingKey, treeTabStop } from "./tree-roving.ts";
import type { RovingTreeNode } from "./tree-roving.ts";

/** Builds one node with optional children. */
function node(id: string, selected = false, children: readonly RovingTreeNode[] = []): RovingTreeNode {
  return { id, selected, children };
}

const TREE: readonly RovingTreeNode[] = [
  node("otto", false, [node("otto/block-1"), node("otto/tangent", false, [node("otto/tangent/block-2")])]),
  node("neara"),
];

test("the horizontal arrows move like the vertical ones and other keys do not move", () => {
  assert.equal(treeRovingKey("ArrowRight"), "ArrowDown");
  assert.equal(treeRovingKey("ArrowLeft"), "ArrowUp");
  assert.equal(treeRovingKey("ArrowDown"), "ArrowDown");
  assert.equal(treeRovingKey("Home"), "Home");
  assert.equal(treeRovingKey("Enter"), null);
  assert.equal(treeRovingKey(" "), null);
});

test("flattenTree lists every node in reading order, each before its children", () => {
  assert.deepEqual(flattenTree(TREE).map((entry) => entry.id), ["otto", "otto/block-1", "otto/tangent", "otto/tangent/block-2", "neara"]);
});

test("the tab stop is the first selected node, else the first node, else nothing", () => {
  assert.equal(treeTabStop(TREE), "otto");
  const selectedDeep = [node("otto", false, [node("otto/a"), node("otto/b", true)]), node("neara", true)];
  assert.equal(treeTabStop(selectedDeep), "otto/b");
  assert.equal(treeTabStop([]), null);
});
