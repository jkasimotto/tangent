import assert from "node:assert/strict";
import test from "node:test";
import core from "./public/area-board-core.js";

const canvas = { nodes: [{ id: "g", type: "group", x: 0, y: 0, width: 300, height: 300 }, { id: "a", type: "text", text: "A", x: 20, y: 20, width: 40, height: 40 }, { id: "b", type: "text", text: "B", x: 180, y: 25, width: 40, height: 40 }], edges: [] };
test("calculates containment, spatial order, and directional selection", () => {
  assert.equal(core.contains(canvas.nodes[0], canvas.nodes[1]), true);
  assert.deepEqual(core.groupsForNode(canvas, "a"), ["g"]);
  assert.equal(core.directionalNode(canvas.nodes.slice(1), "a", "right").id, "b");
  assert.deepEqual(core.spatialOrder(canvas.nodes.slice(1)).map((node) => node.id), ["a", "b"]);
});
test("preserves IDs and z-order across edit operations", () => {
  const moved = core.updateNode(canvas, "a", { x: 77 });
  assert.deepEqual(moved.nodes.map((node) => node.id), canvas.nodes.map((node) => node.id));
  const promoted = core.replaceNodeWithReference(moved, "a", { file: "otto/a.md" });
  assert.deepEqual(promoted.nodes[1], { id: "a", type: "file", file: "otto/a.md", x: 77, y: 20, width: 40, height: 40 });
});
test("uses the standards-only Inbox group for durable hidden membership", () => {
  const withInbox = core.ensureInbox(canvas);
  const hidden = core.moveIntoInbox(withInbox, "a");
  assert.equal(core.hiddenNodeIds(hidden).has("a"), true);
  assert.deepEqual(core.ensureInbox(withInbox), withInbox);
});
test("showing a hidden block preserves its size and moves it outside the Inbox", () => {
  const hidden = core.moveIntoInbox(core.ensureInbox(canvas), "a");
  const shown = core.moveOutOfInbox(hidden, "a");
  assert.equal(core.hiddenNodeIds(shown).has("a"), false);
  assert.equal(shown.nodes.find((node) => node.id === "a").width, 40);
});
