import test from "node:test";
import assert from "node:assert/strict";
import { computeWorldGeometry, nearestFreeRectangle, provisionalRegions, reprioritizeAreaPlacement, solveAreaMapGesture, solveOwnedElementGesture } from "./public/area-map-world-core.js";

/** Builds one immutable solver baseline from local rectangles and optional hulls. */
function baseline(areaKeys, stored, { blocks = [], ink = [] } = {}) {
  return {
    areas: areaKeys,
    regions: provisionalRegions(areaKeys, new Map(stored)),
    blockHulls: new Map(blocks),
    inkHulls: new Map(ink),
  };
}

/** Reports whether two rectangles have the requested clear space. */
function separated(left, right, gap = 0) {
  return left.x + left.width + gap <= right.x || right.x + right.width + gap <= left.x
    || left.y + left.height + gap <= right.y || right.y + right.height + gap <= left.y;
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
  assert.deepEqual(returned.regions, source.regions);
  assert.deepEqual(returned.changedAreas, new Set());
});

test("applies the complete move and reflows lower-priority sibling branches", () => {
  const source = baseline(["root", "root/a", "root/a/child", "root/b"], [
    ["@root>root", { x: 0, y: 0, width: 1800, height: 1200 }],
    ["root>root/a", { x: 0, y: 0, width: 500, height: 500 }],
    ["root/a>root/a/child", { x: 80, y: 80, width: 300, height: 220 }],
    ["root>root/b", { x: 800, y: 0, width: 400, height: 500 }],
  ]);
  const preview = solveAreaMapGesture(source, { selectedAreas: ["root/a/child"], handle: null, desiredWorldDelta: { x: 3_000, y: 150 } });
  assert.equal(preview.wall, null);
  assert.deepEqual(preview.appliedDelta, { x: 3_000, y: 150 });
  assert.deepEqual(preview.regions.get("root/a/child").storedRect, { x: 3080, y: 230, width: 300, height: 220 });
  assert.ok(separated(preview.geometry.get("root/a").constraint, preview.geometry.get("root/b").constraint, 60));
  assert.notDeepEqual(preview.geometry.get("root/b").layoutOffset, { x: 0, y: 0 });
  assert.ok(preview.geometry.get("root").constraint.width > computeWorldGeometry(source).get("root").constraint.width);
  assert.equal(preview.regions.get("root/a/child").storedRect.y, 230);
});

test("applies direct block and free-ink deltas without sibling walls", () => {
  const source = baseline(["root", "root/child"], [
    ["@root>root", { x: 0, y: 0, width: 1000, height: 700 }],
    ["root>root/child", { x: 400, y: 100, width: 300, height: 220 }],
  ]);
  const block = solveOwnedElementGesture(source, { owner: "root", kind: "block", rect: { x: 100, y: 140, width: 180, height: 80 }, desiredWorldDelta: { x: 800, y: 60 } });
  assert.equal(block.wall, null);
  assert.deepEqual(block.appliedDelta, { x: 800, y: 60 });
  assert.deepEqual(block.rect, { x: 900, y: 200, width: 180, height: 80 });
  assert.ok(block.geometry.get("root").constraint.width > computeWorldGeometry(source).get("root").constraint.width);
  const ink = solveOwnedElementGesture(source, { owner: "root", kind: "ink", rect: { x: 100, y: 140, width: 180, height: 80 }, desiredWorldDelta: { x: 800, y: 60 } });
  assert.equal(ink.wall, null);
  assert.deepEqual(ink.rect, { x: 900, y: 200, width: 180, height: 80 });
});

test("block-driven ancestor growth reflows a lower-priority sibling", () => {
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
  assert.equal(preview.wall, null);
  assert.deepEqual(preview.appliedDelta, { x: 1_500, y: 90 });
  assert.deepEqual(preview.rect, { x: 1600, y: 210, width: 160, height: 80 });
  assert.ok(separated(preview.geometry.get("root/delivery").constraint, preview.geometry.get("root/hackathon").constraint, 60));
  assert.notDeepEqual(preview.geometry.get("root/hackathon").layoutOffset, { x: 0, y: 0 });
});

for (const [operation, initialHull, start, delta] of [
  ["inserting", null, { x: 100, y: 500, width: 160, height: 80 }, { x: 0, y: 0 }],
  ["moving", { x: 100, y: 100, width: 160, height: 80 }, { x: 100, y: 100, width: 160, height: 80 }, { x: 0, y: 400 }],
]) test(`${operation} a block anchors an auto-reflowed owner before reprioritizing it`, () => {
  const source = baseline(["root", "root/a", "root/b"], [
    ["@root>root", { x: 0, y: 0, width: 1800, height: 1200 }],
    ["root>root/a", { x: 100, y: 100, width: 500, height: 400 }],
    ["root>root/b", { x: 100, y: 100, width: 500, height: 400 }],
  ], { blocks: initialHull ? [["root/b", initialHull]] : [] });
  source.regions.get("root/a").layout = { schema: "area-placement.v1", priority: 2, overlapWith: [] };
  source.regions.get("root/b").layout = { schema: "area-placement.v1", priority: 1, overlapWith: [] };
  const before = computeWorldGeometry(source);
  const ownerBefore = before.get("root/b").resolvedStored;
  assert.notDeepEqual(ownerBefore, source.regions.get("root/b").storedRect, "the lower-priority owner starts at derived placement");

  const solved = solveOwnedElementGesture(source, {
    owner: "root/b", kind: "block", rect: start,
    remainingBlockHull: null, desiredWorldDelta: delta,
  });
  const regions = new Map(source.regions);
  regions.set("root/b", reprioritizeAreaPlacement(source.regions.get("root/b"), ownerBefore, 3));
  const blockHulls = new Map([["root/b", solved.rect]]);
  const after = computeWorldGeometry({ ...source, regions, blockHulls });

  assert.deepEqual(after.get("root/b").resolvedStored, ownerBefore, "the edited owner stays under the block and pointer");
  assert.deepEqual(after.get("root/b").layoutOffset, { x: 0, y: 0 }, "the former derived placement becomes authored");
  assert.deepEqual(regions.get("root/b").layout, { schema: "area-placement.v1", priority: 3, overlapWith: [] });
  assert.notDeepEqual(after.get("root/a").resolvedStored, before.get("root/a").resolvedStored, "the lower-priority sibling moves instead");
  assert.ok(separated(after.get("root/a").constraint, after.get("root/b").constraint, 60));
  assert.equal(ownerBefore.y + 40 + solved.rect.y, after.get("root/b").resolvedStored.y + 40 + solved.rect.y, "the block keeps its composed y coordinate");

  const reloadedRegions = new Map([...regions].map(([area, region]) => [area, structuredClone(region)]));
  const reloaded = computeWorldGeometry({ ...source, regions: reloadedRegions, blockHulls: new Map(blockHulls) });
  assert.deepEqual(reloaded, after, "persisted placement reloads to the same resolved world");
});

test("a direct resize keeps its preferred rectangle and derives sibling reflow", () => {
  const source = baseline(["root", "root/a", "root/b"], [
    ["@root>root", { x: 0, y: 0, width: 1500, height: 900 }],
    ["root>root/a", { x: 0, y: 0, width: 500, height: 500 }],
    ["root>root/b", { x: 800, y: 0, width: 400, height: 500 }],
  ]);
  const preview = solveAreaMapGesture(source, { selectedAreas: ["root/a"], handle: "e", desiredWorldDelta: { x: 500, y: 0 } });
  assert.equal(preview.wall, null);
  assert.deepEqual(preview.regions.get("root/a").storedRect, { x: 0, y: 0, width: 1000, height: 500 });
  assert.deepEqual(preview.regions.get("root/a").layout, { schema: "area-placement.v1", priority: 1, overlapWith: [] });
  assert.deepEqual(preview.regions.get("root/b").storedRect, source.regions.get("root/b").storedRect);
  assert.ok(separated(preview.geometry.get("root/a").constraint, preview.geometry.get("root/b").constraint, 60));
  assert.notDeepEqual(preview.geometry.get("root/b").layoutOffset, { x: 0, y: 0 });
  assert.ok(preview.geometry.get("root/a").branchPriority > preview.geometry.get("root/b").branchPriority);
});

test("a direct move records and later clears the exact symmetric overlap pair", () => {
  const source = baseline(["root", "root/a", "root/b"], [
    ["@root>root", { x: 0, y: 0, width: 1300, height: 800 }],
    ["root>root/a", { x: 0, y: 0, width: 300, height: 220 }],
    ["root>root/b", { x: 500, y: 0, width: 300, height: 220 }],
  ]);
  const overlapped = solveAreaMapGesture(source, { selectedAreas: ["root/a"], handle: null, desiredWorldDelta: { x: 500, y: 0 } });
  assert.deepEqual(overlapped.regions.get("root/a").layout.overlapWith, ["root/b"]);
  assert.deepEqual(overlapped.regions.get("root/b").layout.overlapWith, ["root/a"]);
  assert.deepEqual(overlapped.changedAreas, new Set(["root/a", "root/b"]));
  assert.equal(separated(overlapped.geometry.get("root/a").constraint, overlapped.geometry.get("root/b").constraint), false);
  assert.deepEqual(overlapped.geometry.get("root/b").layoutOffset, { x: 0, y: 0 });

  const movedApart = solveAreaMapGesture({ ...source, regions: overlapped.regions }, { selectedAreas: ["root/a"], handle: null, desiredWorldDelta: { x: 500, y: 0 } });
  assert.deepEqual(movedApart.regions.get("root/a").layout.overlapWith, []);
  assert.deepEqual(movedApart.regions.get("root/b").layout.overlapWith, []);
  assert.deepEqual(movedApart.changedAreas, new Set(["root/a", "root/b"]));
  assert.ok(separated(movedApart.geometry.get("root/a").constraint, movedApart.geometry.get("root/b").constraint, 60));
  assert.deepEqual(movedApart.geometry.get("root/b").resolvedStored, movedApart.regions.get("root/b").storedRect);
});

test("one-sided placement metadata cannot disable automatic spacing", () => {
  const source = baseline(["root", "root/a", "root/b"], [
    ["@root>root", { x: 0, y: 0, width: 1300, height: 800 }],
    ["root>root/a", { x: 0, y: 0, width: 300, height: 220 }],
    ["root>root/b", { x: 0, y: 0, width: 300, height: 220 }],
  ]);
  source.regions.get("root/a").layout = { schema: "area-placement.v1", priority: 1, overlapWith: ["root/b"] };
  source.regions.get("root/b").layout = { schema: "area-placement.v1", priority: 0, overlapWith: [] };

  const geometry = computeWorldGeometry(source);

  assert.ok(separated(geometry.get("root/a").constraint, geometry.get("root/b").constraint, 60));
});

test("moving a parent translates its subtree without rewriting descendant preferences", () => {
  const source = baseline(["root", "root/parent", "root/parent/child"], [
    ["@root>root", { x: 0, y: 0, width: 1400, height: 900 }],
    ["root>root/parent", { x: 100, y: 120, width: 700, height: 560 }],
    ["root/parent>root/parent/child", { x: 80, y: 90, width: 300, height: 220 }],
  ]);
  const child = structuredClone(source.regions.get("root/parent/child"));
  const preview = solveAreaMapGesture(source, { selectedAreas: ["root/parent"], handle: null, desiredWorldDelta: { x: 260, y: 180 } });
  assert.deepEqual(preview.regions.get("root/parent").storedRect, { x: 360, y: 300, width: 700, height: 560 });
  assert.deepEqual(preview.regions.get("root/parent/child"), child);
  assert.deepEqual(preview.geometry.get("root/parent/child").stored, child.storedRect);
});

test("nearestFreeRectangle is deterministic across occupied input order", () => {
  const preferred = { x: 100, y: 100, width: 300, height: 220 };
  const occupied = [
    { x: 50, y: 50, width: 400, height: 320 },
    { x: 510, y: 50, width: 300, height: 320 },
  ];
  const forward = nearestFreeRectangle(preferred, occupied, { gap: 60 });
  const reversed = nearestFreeRectangle(preferred, occupied.toReversed(), { gap: 60 });
  assert.deepEqual(forward, reversed);
  assert.deepEqual({ width: forward.width, height: forward.height }, { width: preferred.width, height: preferred.height });
  assert.ok(occupied.every((wall) => separated(forward, wall, 60)));
});

test("a newly inserted block takes the nearest free cardinal position", () => {
  const preferred = { x: 100, y: 100, width: 180, height: 80 };
  const existing = [{ x: 100, y: 100, width: 180, height: 80 }];
  const snapshot = structuredClone(existing);
  assert.deepEqual(nearestFreeRectangle(preferred, existing, { gap: 60 }), { x: 100, y: -40, width: 180, height: 80 });
  assert.deepEqual(existing, snapshot, "derived insertion does not rewrite existing authored blocks");
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

test("direct resize starts at the descendant-expanded visible handles", () => {
  const source = baseline(["root", "root/child"], [
    ["@root>root", { x: 0, y: 0, width: 300, height: 220 }],
    ["root>root/child", { x: 60, y: 60, width: 300, height: 220 }],
  ]);
  const before = computeWorldGeometry(source).get("root").constraint;
  assert.deepEqual(before, { x: 0, y: 0, width: 420, height: 380 });
  const preview = solveAreaMapGesture(source, { selectedAreas: ["root"], handle: "e", desiredWorldDelta: { x: 40, y: 0 } });
  assert.equal(preview.regions.get("root").storedRect.width, 460);
  assert.equal(preview.geometry.get("root").constraint.width, before.width + 40, "the visible edge follows the complete pointer delta");
  assert.deepEqual(preview.regions.get("root/child").storedRect, source.regions.get("root/child").storedRect, "the descendant keeps its own geometry");
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
