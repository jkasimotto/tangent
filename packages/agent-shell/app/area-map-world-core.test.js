import test from "node:test";
import assert from "node:assert/strict";
import { composeAreaMapWorld, computeWorldGeometry, provisionalRegions, shardHulls, solveAreaMapGesture } from "./public/area-map-world-core.js";

const areas = ["neara", "neara/delivery", "neara/delivery/standards"];

test("builds one deterministic live region for every Area tree edge", () => {
  const regions = provisionalRegions([...areas].reverse());
  assert.equal(regions.size, 3);
  assert.deepEqual([...regions.keys()], areas);
  for (const region of regions.values()) {
    assert.equal(region.source, "provisional");
    assert.match(region.sourceId, /^tangent-region-/);
  }
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

test("the solver uses the pointer baseline and prevents a large jump through a sibling", () => {
  const tree = ["root", "root/a", "root/b"];
  const stored = new Map([
    ["@root>root", { x: 0, y: 0, width: 1600, height: 1000 }],
    ["root>root/a", { x: 0, y: 0, width: 300, height: 220 }],
    ["root>root/b", { x: 500, y: 0, width: 300, height: 220 }],
  ]);
  const regions = provisionalRegions(tree, stored);
  const baseline = { areas: tree, regions, blockHulls: new Map(), inkHulls: new Map() };
  const preview = solveAreaMapGesture(baseline, { selectedAreas: ["root/a"], handle: null, desiredWorldDelta: { x: 900, y: 0 } });
  assert.equal(preview.wall, "root/b");
  assert.ok(preview.regions.get("root/a").storedRect.x + 300 <= 500.01);
  assert.deepEqual(solveAreaMapGesture(baseline, { selectedAreas: ["root/a"], handle: null, desiredWorldDelta: { x: 900, y: 0 } }), preview);
});

test("an expanded ancestor stops at its sibling and preserves tangential motion", () => {
  const tree = ["root", "root/a", "root/a/child", "root/b"];
  const regions = provisionalRegions(tree, new Map([
    ["@root>root", { x: 0, y: 0, width: 1800, height: 1200 }],
    ["root>root/a", { x: 0, y: 0, width: 500, height: 500 }],
    ["root/a>root/a/child", { x: 80, y: 80, width: 300, height: 220 }],
    ["root>root/b", { x: 800, y: 0, width: 400, height: 500 }],
  ]));
  const preview = solveAreaMapGesture({ areas: tree, regions, blockHulls: new Map(), inkHulls: new Map() }, { selectedAreas: ["root/a/child"], handle: null, desiredWorldDelta: { x: 900, y: 150 } });
  assert.equal(preview.wall, "root/b");
  assert.ok(preview.geometry.get("root/a").constraint.x + preview.geometry.get("root/a").constraint.width <= 800.01);
  assert.equal(preview.regions.get("root/a/child").storedRect.y, 230);
});

test("authored blocks expand containment while free ink expands only the drawn outline", () => {
  const scene = { elements: [
    { id: "block", x: 500, y: 300, width: 200, height: 100, customData: { tangent: { ref: "goal-x" } } },
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
  const world = { locatedArea: areas.at(-1), areas: areas.map((key) => ({ key, parent: regions.get(key).owner, region: regions.get(key), shard: { state: "ready", scene: { elements: [], files: {} } } })) };
  const composed = composeAreaMapWorld(world);
  const live = composed.scene.elements.filter((element) => element.customData?.tangent?.role === "area-region");
  assert.deepEqual(live.map((element) => element.customData.tangent.area), areas);
  assert.ok(live.every((element) => element.locked === false && element.isDeleted === false));
  assert.equal(new Set(live.map((element) => element.id)).size, areas.length);
});
