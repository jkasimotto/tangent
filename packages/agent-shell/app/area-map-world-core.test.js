import test from "node:test";
import assert from "node:assert/strict";
import { composeAreaMapWorld, computeWorldGeometry, detachCrossOwnerTextBindings, protectAreaRegions, provisionalRegions, shardHulls, solveAreaMapGesture, splitComposed } from "./public/area-map-world-core.js";

const areas = ["neara", "neara/delivery", "neara/delivery/standards"];

/** Reports whether two rectangles have the automatic layout clearance. */
function separated(left, right, gap = 60) {
  return left.x + left.width + gap <= right.x || right.x + right.width + gap <= left.x
    || left.y + left.height + gap <= right.y || right.y + right.height + gap <= left.y;
}

test("builds one deterministic live region for every Area tree edge", () => {
  const regions = provisionalRegions([...areas].reverse());
  assert.equal(regions.size, 3);
  assert.deepEqual([...regions.keys()], areas);
  for (const region of regions.values()) {
    assert.equal(region.source, "provisional");
    assert.match(region.sourceId, /^tangent-region-/);
  }
});

test("provisional placement preserves stored rectangles and uses nearest 2D free space", () => {
  const saved = { x: 60, y: 60, width: 460, height: 320 };
  const regions = provisionalRegions(["root", "root/a", "root/b", "root/c"], new Map([["root>root/b", saved]]));
  assert.deepEqual(regions.get("root/b").storedRect, saved);
  assert.equal(regions.get("root/b").source, "stored");
  assert.deepEqual(regions.get("root/a").storedRect, { x: 60, y: -320, width: 460, height: 320 });
  assert.deepEqual(regions.get("root/c").storedRect, { x: 60, y: 440, width: 460, height: 320 });
  assert.ok(separated(regions.get("root/a").storedRect, regions.get("root/b").storedRect));
  assert.ok(separated(regions.get("root/b").storedRect, regions.get("root/c").storedRect));
});

test("Standards never crosses Delivery while Delivery and Neara grow", () => {
  const stored = new Map([
    ["@root>neara", { x: 80, y: 80, width: 1100, height: 800 }],
    ["neara>neara/delivery", { x: 100, y: 100, width: 900, height: 600 }],
    ["neara/delivery>neara/delivery/standards", { x: 120, y: 120, width: 620, height: 420 }],
  ]);
  const regions = provisionalRegions(areas, stored);
  const before = computeWorldGeometry({ areas, regions });
  const preview = solveAreaMapGesture({ areas, regions, blockHulls: new Map(), inkHulls: new Map() }, { selectedAreas: ["neara/delivery/standards"], handle: "e", desiredWorldDelta: { x: 320, y: 0 } });
  assert.equal(preview.valid, true);
  assert.equal(preview.regions.get("neara/delivery/standards").storedRect.width, 940);
  assert.ok(preview.geometry.get("neara/delivery").constraint.width > before.get("neara/delivery").constraint.width);
  assert.ok(preview.geometry.get("neara").constraint.width > before.get("neara").constraint.width);
  assert.equal(regions.get("neara/delivery").storedRect.width, 900, "computed growth does not mutate stored ancestors");
});

test("the solver uses the pointer baseline and applies a large jump exactly", () => {
  const tree = ["root", "root/a", "root/b"];
  const stored = new Map([
    ["@root>root", { x: 0, y: 0, width: 1600, height: 1000 }],
    ["root>root/a", { x: 0, y: 0, width: 300, height: 220 }],
    ["root>root/b", { x: 500, y: 0, width: 300, height: 220 }],
  ]);
  const regions = provisionalRegions(tree, stored);
  const baseline = { areas: tree, regions, blockHulls: new Map(), inkHulls: new Map() };
  const preview = solveAreaMapGesture(baseline, { selectedAreas: ["root/a"], handle: null, desiredWorldDelta: { x: 900, y: 0 } });
  assert.equal(preview.wall, null);
  assert.deepEqual(preview.appliedDelta, { x: 900, y: 0 });
  assert.equal(preview.regions.get("root/a").storedRect.x, 900);
  assert.ok(separated(preview.geometry.get("root/a").constraint, preview.geometry.get("root/b").constraint));
  assert.deepEqual(solveAreaMapGesture(baseline, { selectedAreas: ["root/a"], handle: null, desiredWorldDelta: { x: 900, y: 0 } }), preview);
});

test("an expanded ancestor reflows its lower-priority sibling", () => {
  const tree = ["root", "root/a", "root/a/child", "root/b"];
  const regions = provisionalRegions(tree, new Map([
    ["@root>root", { x: 0, y: 0, width: 1800, height: 1200 }],
    ["root>root/a", { x: 0, y: 0, width: 500, height: 500 }],
    ["root/a>root/a/child", { x: 80, y: 80, width: 300, height: 220 }],
    ["root>root/b", { x: 800, y: 0, width: 400, height: 500 }],
  ]));
  const preview = solveAreaMapGesture({ areas: tree, regions, blockHulls: new Map(), inkHulls: new Map() }, { selectedAreas: ["root/a/child"], handle: null, desiredWorldDelta: { x: 900, y: 150 } });
  assert.equal(preview.wall, null);
  assert.deepEqual(preview.appliedDelta, { x: 900, y: 150 });
  assert.ok(separated(preview.geometry.get("root/a").constraint, preview.geometry.get("root/b").constraint));
  assert.notDeepEqual(preview.geometry.get("root/b").layoutOffset, { x: 0, y: 0 });
  assert.equal(preview.regions.get("root/a/child").storedRect.y, 230);
});

test("authored blocks expand containment while free ink expands only the drawn outline", () => {
  const scene = { elements: [
    { id: "block", x: 500, y: 300, width: 200, height: 100, customData: { tangent: { kind: "goal", ref: "goal-x" } } },
    { id: "ink", x: -200, y: -100, width: 20, height: 20, customData: {} },
  ] };
  const hulls = shardHulls(scene);
  assert.deepEqual(hulls.blocks, { x: 500, y: 300, width: 200, height: 100 });
  assert.deepEqual(hulls.ink, { x: -200, y: -100, width: 20, height: 20 });
  const regions = provisionalRegions(["root"], new Map([["@root>root", { x: 0, y: 0, width: 300, height: 220 }]]));
  const geometry = computeWorldGeometry({ areas: ["root"], regions, blockHulls: new Map([["root", hulls.blocks]]), inkHulls: new Map([["root", hulls.ink]]) }).get("root");
  assert.ok(geometry.constraint.width >= 760);
  assert.ok(geometry.drawn.x < geometry.constraint.x);
});

test("composes every ancestor and descendant as one unlocked interactive region", () => {
  const regions = provisionalRegions(areas);
  const world = { locatedArea: areas.at(-1), areas: areas.map((key) => ({
    key, parent: regions.get(key).owner, region: regions.get(key),
    shard: { state: "ready", scene: { elements: key === "neara" ? [{ id: "parent-block", type: "rectangle", x: 80, y: 80, width: 180, height: 100 }] : [], files: {} } },
  })) };
  const composed = composeAreaMapWorld(world);
  const live = composed.scene.elements.filter((element) => element.customData?.tangent?.role === "area-region");
  assert.deepEqual(live.map((element) => element.customData.tangent.area), areas);
  assert.ok(live.every((element) => element.locked === false && element.isDeleted === false));
  assert.equal(new Set(live.map((element) => element.id)).size, areas.length);
  assert.ok(composed.scene.elements.findIndex((element) => element.customData?.tangentWorld?.sourceId === "parent-block") > composed.scene.elements.findLastIndex((element) => element.customData?.tangent?.role === "area-region"), "authored content stays above every transparent structural outline");
});

test("places a drawn outline at the computed left and top overflow", () => {
  const regions = provisionalRegions(["root"], new Map([["@root>root", { x: 80, y: 80, width: 300, height: 220 }]]));
  const world = { locatedArea: "root", areas: [{
    key: "root", parent: "@root", region: regions.get("root"),
    shard: { state: "ready", scene: { elements: [{ id: "ink", type: "rectangle", x: -200, y: -100, width: 20, height: 20, customData: {} }], files: {} } },
  }] };
  const composed = composeAreaMapWorld(world);
  const region = composed.scene.elements.find((element) => element.customData?.tangent?.role === "area-region");
  assert.deepEqual({ x: region.x, y: region.y, width: region.width, height: region.height }, composed.regionRects.get("root"));
  assert.equal(region.x, -180);
  assert.equal(region.y, -40);
  assert.deepEqual(composed.offsets.get("root"), { x: 80, y: 120 }, "the content anchor stays at the stored rectangle");
});

test("restores every structural region after delete or eraser output", () => {
  const regions = provisionalRegions(areas);
  const world = { locatedArea: areas.at(-1), areas: areas.map((key) => ({ key, parent: regions.get(key).owner, region: regions.get(key), shard: { state: "ready", scene: { elements: [], files: {} } } })) };
  const composed = composeAreaMapWorld(world);
  const withoutDelivery = composed.scene.elements.filter((element) => element.customData?.tangent?.area !== "neara/delivery");
  const protectedScene = protectAreaRegions(composed.scene.elements, withoutDelivery);
  const live = protectedScene.filter((element) => element.customData?.tangent?.role === "area-region");
  assert.deepEqual(live.map((element) => element.customData.tangent.area), areas);
  assert.ok(live.every((element) => element.locked === false && element.isDeleted === false));
});

test("decomposes one multi-owner composed change without changing unrelated source identities", () => {
  const regions = provisionalRegions(["root", "root/child"]);
  const world = { locatedArea: "root/child", areas: [
    { key: "root", parent: "@root", region: regions.get("root"), shard: { state: "ready", scene: { elements: [{ id: "parent", type: "rectangle", x: 10, y: 20, width: 30, height: 40 }], files: {} } } },
    { key: "root/child", parent: "root", region: regions.get("root/child"), shard: { state: "ready", scene: { elements: [{ id: "child", type: "rectangle", x: 15, y: 25, width: 35, height: 45 }], files: {} } } },
  ] };
  const composed = composeAreaMapWorld(world);
  const authored = composed.scene.elements.filter((element) => element.customData?.tangent?.role !== "area-region").map((element) => ({ ...element, x: element.x + 5 }));
  const split = splitComposed(authored, composed.origins, composed.offsets);
  assert.deepEqual([...split.keys()], ["root", "root/child"]);
  assert.equal(split.get("root")[0].id, "parent");
  assert.equal(split.get("root")[0].x, 15);
  assert.equal(split.get("root/child")[0].id, "child");
  assert.equal(split.get("root/child")[0].x, 20);
});

test("detaches only text containers that cross source owners before partitioning", () => {
  const parent = { id: "parent", type: "rectangle", boundElements: [{ id: "foreign-text", type: "text" }, { id: "cross-arrow", type: "arrow" }] };
  const local = { id: "local", type: "rectangle", boundElements: [{ id: "local-text", type: "text" }] };
  const foreignText = { id: "foreign-text", type: "text", containerId: "parent" };
  const localText = { id: "local-text", type: "text", containerId: "local" };
  const origins = new Map([
    ["parent", { owner: "root", sourceId: "parent" }],
    ["local", { owner: "root", sourceId: "local" }],
    ["foreign-text", { owner: "root/child", sourceId: "foreign-text" }],
    ["local-text", { owner: "root", sourceId: "local-text" }],
  ]);

  assert.equal(detachCrossOwnerTextBindings([parent, local, foreignText, localText], origins), 1);
  assert.equal(foreignText.containerId, null);
  assert.deepEqual(parent.boundElements, [{ id: "cross-arrow", type: "arrow" }]);
  assert.equal(localText.containerId, "local");
  assert.deepEqual(local.boundElements, [{ id: "local-text", type: "text" }]);
});
