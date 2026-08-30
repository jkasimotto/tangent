import test from "node:test";
import assert from "node:assert/strict";
import { computeWorldGeometry, provisionalRegions, solveAreaMapGesture } from "./public/area-map-world-core.js";

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
