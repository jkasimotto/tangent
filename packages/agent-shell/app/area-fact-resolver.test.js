import assert from "node:assert/strict";
import test from "node:test";
import resolver from "./public/area-fact-resolver.js";
test("refreshes facts without geometry changes and creates ghosts for missing sources", () => {
  const node = { id: "n", type: "file", file: "otto/goal.md", x: 1, y: 2, width: 3, height: 4 };
  const found = resolver.resolveFileNode(node, [{ file: "otto/goal.md", title: "New fact", status: "active" }]);
  assert.equal(found.fact.title, "New fact"); assert.deepEqual(found.geometry, { id: "n", x: 1, y: 2, width: 3, height: 4 }); assert.equal(found.node, node);
  assert.equal(resolver.resolveFileNode(node, []).fact.ghost, true);
});
