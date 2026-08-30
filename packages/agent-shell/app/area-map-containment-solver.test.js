import test from "node:test";
import assert from "node:assert/strict";
import { computeWorldGeometry, provisionalRegions, solveAreaMapGesture, solveOwnedElementGesture } from "./public/area-map-world-core.js";

/** Builds one immutable solver baseline from local rectangles and optional hulls. */
function baseline(areaKeys, stored, { blocks = [], ink = [] } = {}) {
  return {
    areas: areaKeys,
    regions: provisionalRegions(areaKeys, new Map(stored)),
    blockHulls: new Map(blocks),
    inkHulls: new Map(ink),
  };
}

test("grows every ancestor during a child drag and shrinks them when the child returns", () => {
  const source = baseline(["root", "root/parent", "root/parent/child"], [
    ["@root>root", { x: 0, y: 0, width: 760, height: 620 }],
    ["root>root/parent", { x: 60, y: 60, width: 500, height: 380 }],
    ["root/parent>root/parent/child", { x: 60, y: 60, width: 300, height: 220 }],
  ]);
  const before = computeWorldGeometry(source);
  const grown = solveAreaMapGesture(source, { selectedAreas: ["root/parent/child"], handle: null, desiredWorldDelta: { x: 360, y: 120 } });
  assert.ok(grown.geometry.get("root/parent").constraint.width > before.get("root/parent").constraint.width);
  assert.ok(grown.geometry.get("root").constraint.width > before.get("root").constraint.width);
  assert.deepEqual(grown.regions.get("root/parent").storedRect, source.regions.get("root/parent").storedRect);
  assert.deepEqual(grown.regions.get("root").storedRect, source.regions.get("root").storedRect);
  const returned = solveAreaMapGesture(source, { selectedAreas: ["root/parent/child"], handle: null, desiredWorldDelta: { x: 0, y: 0 } });
  assert.deepEqual(returned.geometry, before);
});

test("stops at each sibling level, prevents tunnelling, and preserves tangential motion", () => {
  const source = baseline(["root", "root/a", "root/a/child", "root/b"], [
    ["@root>root", { x: 0, y: 0, width: 1800, height: 1200 }],
    ["root>root/a", { x: 0, y: 0, width: 500, height: 500 }],
    ["root/a>root/a/child", { x: 80, y: 80, width: 300, height: 220 }],
    ["root>root/b", { x: 800, y: 0, width: 400, height: 500 }],
  ]);
  const preview = solveAreaMapGesture(source, { selectedAreas: ["root/a/child"], handle: null, desiredWorldDelta: { x: 3_000, y: 150 } });
  assert.equal(preview.wall, "root/b");
  assert.ok(preview.geometry.get("root/a").constraint.x + preview.geometry.get("root/a").constraint.width <= 800.01);
  assert.equal(preview.regions.get("root/a/child").storedRect.y, 230);
});

test("stops a parent block at its direct child but lets free ink cross every wall", () => {
  const source = baseline(["root", "root/child"], [
    ["@root>root", { x: 0, y: 0, width: 1000, height: 700 }],
    ["root>root/child", { x: 400, y: 100, width: 300, height: 220 }],
  ]);
  const block = solveOwnedElementGesture(source, { owner: "root", kind: "block", rect: { x: 100, y: 140, width: 180, height: 80 }, desiredWorldDelta: { x: 800, y: 60 } });
  assert.equal(block.wall, "root/child");
  assert.ok(block.rect.x + block.rect.width <= 400.01);
  assert.equal(block.rect.y, 200, "the block slides on the free axis");
  const ink = solveOwnedElementGesture(source, { owner: "root", kind: "ink", rect: { x: 100, y: 140, width: 180, height: 80 }, desiredWorldDelta: { x: 800, y: 60 } });
  assert.equal(ink.wall, null);
  assert.deepEqual(ink.rect, { x: 900, y: 200, width: 180, height: 80 });
});

test("stops block-driven ancestor growth at every sibling level", () => {
  const source = baseline(["root", "root/delivery", "root/hackathon"], [
    ["@root>root", { x: 0, y: 0, width: 1600, height: 900 }],
    ["root>root/delivery", { x: 0, y: 0, width: 500, height: 500 }],
    ["root>root/hackathon", { x: 800, y: 0, width: 400, height: 500 }],
  ]);
  const preview = solveOwnedElementGesture(source, {
    owner: "root/delivery", kind: "block",
    rect: { x: 100, y: 120, width: 160, height: 80 },
    remainingBlockHull: null,
    desiredWorldDelta: { x: 1_500, y: 90 },
  });
  assert.equal(preview.wall, "root/hackathon");
  assert.ok(preview.geometry.get("root/delivery").constraint.x + preview.geometry.get("root/delivery").constraint.width <= 800.01);
  assert.equal(preview.rect.y, 210, "the block keeps motion along the sibling wall");
});

test("clamps direct shrink to blocks, children, the label band, and the minimum size", () => {
  const source = baseline(["root", "root/child"], [
    ["@root>root", { x: 0, y: 0, width: 900, height: 700 }],
    ["root>root/child", { x: 80, y: 80, width: 300, height: 220 }],
  ], { blocks: [["root", { x: 500, y: 360, width: 180, height: 100 }]] });
  const preview = solveAreaMapGesture(source, { selectedAreas: ["root"], handle: "es", desiredWorldDelta: { x: -2_000, y: -2_000 } });
  const stored = preview.regions.get("root").storedRect;
  assert.ok(stored.width >= 740, `block plus margin remains inside: ${JSON.stringify(stored)}`);
  assert.ok(stored.height >= 560, `label, block, and margin remain inside: ${JSON.stringify(stored)}`);
  assert.ok(stored.width >= 300 && stored.height >= 220);
  assert.deepEqual(preview.geometry.get("root").stored, preview.geometry.get("root").constraint, "a direct resize stores the rectangle under its handles");
});

test("left and top resize moves the subtree anchor without scaling descendants", () => {
  const source = baseline(["root", "root/child"], [
    ["@root>root", { x: 100, y: 120, width: 900, height: 700 }],
    ["root>root/child", { x: 80, y: 90, width: 300, height: 220 }],
  ]);
  const preview = solveAreaMapGesture(source, { selectedAreas: ["root"], handle: "nw", desiredWorldDelta: { x: 100, y: 80 } });
  assert.equal(preview.regions.get("root").storedRect.x, 200);
  assert.equal(preview.regions.get("root").storedRect.y, 200);
  assert.deepEqual(preview.regions.get("root/child").storedRect, source.regions.get("root/child").storedRect);
});

test("returns byte-identical results for the same baseline and intent", () => {
  const source = baseline(["root", "root/a", "root/b"], [
    ["@root>root", { x: 0, y: 0, width: 1200, height: 800 }],
    ["root>root/a", { x: 40, y: 60, width: 300, height: 220 }],
    ["root>root/b", { x: 520, y: 60, width: 300, height: 220 }],
  ]);
  const intent = { selectedAreas: ["root/a"], handle: "e", desiredWorldDelta: { x: 900, y: 75 } };
  assert.deepEqual(solveAreaMapGesture(source, intent), solveAreaMapGesture(source, intent));
});
