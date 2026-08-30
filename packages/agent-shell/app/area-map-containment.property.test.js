import test from "node:test";
import assert from "node:assert/strict";
import { composeAreaMapWorld, composeShard, computeWorldGeometry, provisionalRegions, solveAreaMapGesture, splitComposed } from "./public/area-map-world-core.js";

/** Creates one repeatable unsigned pseudo-random stream. */
function random(seed) {
  let state = seed >>> 0;
  return () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 0x1_0000_0000);
}

/** Returns a deterministic tree whose stored siblings start separated. */
function generated(seed) {
  const next = random(seed);
  const depth = 1 + Math.floor(next() * 6);
  const areas = ["root"];
  let parent = "root";
  for (let level = 1; level <= depth; level += 1) {
    const count = 1 + Math.floor(next() * 20);
    for (let sibling = 0; sibling < count; sibling += 1) areas.push(`${parent}/n${level}-${sibling}`);
    parent = `${parent}/n${level}-0`;
  }
  const children = new Map();
  for (const area of areas.slice(1)) {
    const owner = area.slice(0, area.lastIndexOf("/"));
    const list = children.get(owner) ?? [];
    list.push(area); children.set(owner, list);
  }
  const sizes = new Map();
  for (const area of areas.slice().sort((left, right) => right.split("/").length - left.split("/").length)) {
    const direct = children.get(area) ?? [];
    sizes.set(area, direct.length ? {
      width: Math.max(360, 60 + direct.reduce((sum, child) => sum + sizes.get(child).width + 60, 0)),
      height: Math.max(280, 160 + Math.max(...direct.map((child) => sizes.get(child).height))),
    } : { width: 360, height: 280 });
  }
  const stored = new Map();
  stored.set("@root>root", { x: 20, y: 20, ...sizes.get("root") });
  for (const [owner, direct] of children) {
    let x = 60;
    for (const area of direct.sort()) {
      stored.set(`${owner}>${area}`, { x, y: 60, ...sizes.get(area) });
      x += sizes.get(area).width + 60;
    }
  }
  return { next, areas, regions: provisionalRegions(areas, stored), selected: parent };
}

/** Normalizes Map insertion order for a deterministic comparison. */
function normalized(preview) {
  return {
    wall: preview.wall,
    valid: preview.valid,
    regions: [...preview.regions].sort(([left], [right]) => left.localeCompare(right)),
    geometry: [...preview.geometry].sort(([left], [right]) => left.localeCompare(right)),
  };
}

/** Reports strict rectangle overlap. */
function overlaps(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

test("seeded containment properties hold for mixed trees and large pointer jumps", () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    try {
      const fixture = generated(seed);
      const blockHulls = new Map(fixture.areas.filter((_area, index) => index % 3 === seed % 3).map((area) => [area, { x: 80, y: 80, width: 90, height: 60 }]));
      const inkHulls = new Map(fixture.areas.filter((_area, index) => index % 5 === seed % 5).map((area) => [area, { x: -30, y: 40, width: 35, height: 25 }]));
      const baseline = { areas: fixture.areas, regions: fixture.regions, blockHulls, inkHulls };
      const handles = [null, null, "e", "s", "se", "w", "n"];
      const intent = { selectedAreas: [fixture.selected], handle: handles[seed % handles.length], desiredWorldDelta: { x: Math.round((fixture.next() - 0.2) * 4_000), y: Math.round((fixture.next() - 0.5) * 600) } };
      const preview = solveAreaMapGesture(baseline, intent);
      assert.equal(preview.valid, true);

      const world = { locatedArea: fixture.selected, areas: fixture.areas.map((key) => ({
        key, parent: preview.regions.get(key).owner, children: fixture.areas.filter((candidate) => preview.regions.get(candidate).owner === key),
        region: preview.regions.get(key), shard: { state: "ready", scene: { elements: [], files: {} } },
      })) };
      const composed = composeAreaMapWorld(world);
      for (const node of world.areas) {
        if (node.parent === "@root") continue;
        const parent = composed.regionRects.get(node.parent);
        const child = composed.regionRects.get(node.key);
        assert.ok(child.x >= parent.x - 0.01 && child.y >= parent.y - 0.01 && child.x + child.width <= parent.x + parent.width + 0.01 && child.y + child.height <= parent.y + parent.height + 0.01);
      }
      for (const node of world.areas) for (const sibling of world.areas) {
        if (node.key >= sibling.key || node.parent !== sibling.parent) continue;
        assert.equal(overlaps(preview.geometry.get(node.key).constraint, preview.geometry.get(sibling.key).constraint), false, JSON.stringify({ node: node.key, sibling: sibling.key, left: preview.geometry.get(node.key).constraint, right: preview.geometry.get(sibling.key).constraint, wall: preview.wall }));
      }
      for (const [area, region] of fixture.regions) if (area !== fixture.selected) assert.deepEqual(preview.regions.get(area).storedRect, region.storedRect, "unrelated region source stays byte-identical");

      const shuffledAreas = fixture.areas.slice().reverse();
      const shuffledRegions = new Map([...fixture.regions].reverse());
      const shuffled = solveAreaMapGesture({ ...baseline, areas: shuffledAreas, regions: shuffledRegions }, intent);
      assert.deepEqual(normalized(shuffled), normalized(preview));
      const repeated = solveAreaMapGesture(baseline, intent);
      assert.deepEqual(normalized(repeated), normalized(preview), "the accepted pointer preview is idempotent against its immutable baseline");
      const forward = new Map([...baseline.regions].map(([area, region]) => [area, structuredClone(region)]));
      for (const [area, region] of preview.regions) forward.set(area, structuredClone(region));
      const restored = new Map([...forward].map(([area, region]) => [area, structuredClone(region)]));
      for (const [area, region] of baseline.regions) restored.set(area, structuredClone(region));
      assert.deepEqual(restored, baseline.regions, "the command inverse restores the source snapshot");
    } catch (error) {
      console.error(`area-map property seed ${seed}`);
      throw error;
    }
  }
});

test("compose and split is lossless for unchanged authored elements", () => {
  const scene = { elements: [
    { id: "frame", type: "frame", x: 10, y: 20, width: 500, height: 300, groupIds: [], frameId: null },
    { id: "shape", type: "rectangle", x: 30, y: 40, width: 80, height: 60, groupIds: ["group"], frameId: "frame" },
  ], files: {} };
  const composed = composeShard("root/child", scene, { x: 300, y: 400 });
  const split = splitComposed(composed.elements, composed.origins, new Map([["root/child", { x: 300, y: 400 }]])).get("root/child");
  assert.deepEqual(split, scene.elements);
});

/** Returns one wide world for interactive frame-budget checks. */
function largePreviewBaseline() {
  const areas = ["root", ...Array.from({ length: 499 }, (_value, index) => `root/n${index}`)];
  const stored = new Map([
    ["@root>root", { x: 0, y: 0, width: 400_000, height: 1_000 }],
    ...areas.slice(1).map((area, index) => [`root>${area}`, { x: index * 700, y: 60, width: 500, height: 300 }]),
  ]);
  return { areas, regions: provisionalRegions(areas, stored), blockHulls: new Map(), inkHulls: new Map() };
}

test("a 500-Area preview keeps p95 below 8 ms and every frame below 16 ms", () => {
  const baseline = largePreviewBaseline();
  const intent = { selectedAreas: ["root/n0"], handle: null, desiredWorldDelta: { x: 100, y: 20 } };
  for (let index = 0; index < 5; index += 1) solveAreaMapGesture(baseline, intent);
  const samples = [];
  for (let index = 0; index < 21; index += 1) {
    const started = performance.now(); solveAreaMapGesture(baseline, intent); samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  assert.ok(p95 < 8, `p95 preview ${p95.toFixed(2)} ms; samples ${samples.map((value) => value.toFixed(2)).join(", ")}`);
  assert.ok(samples.at(-1) < 16, `max preview ${samples.at(-1).toFixed(2)} ms; samples ${samples.map((value) => value.toFixed(2)).join(", ")}`);
});

test("a blocked 500-Area preview keeps p95 below 8 ms and every frame below 16 ms", () => {
  const baseline = largePreviewBaseline();
  const intent = { selectedAreas: ["root/n0"], handle: null, desiredWorldDelta: { x: 1_000, y: 20 } };
  const preview = solveAreaMapGesture(baseline, intent);
  assert.equal(preview.wall, "root/n1");
  assert.deepEqual(preview.appliedDelta, { x: 200, y: 20 });
  for (let index = 0; index < 5; index += 1) solveAreaMapGesture(baseline, intent);
  const samples = [];
  for (let index = 0; index < 21; index += 1) {
    const started = performance.now(); solveAreaMapGesture(baseline, intent); samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  assert.ok(p95 < 8, `p95 blocked preview ${p95.toFixed(2)} ms; samples ${samples.map((value) => value.toFixed(2)).join(", ")}`);
  assert.ok(samples.at(-1) < 16, `max blocked preview ${samples.at(-1).toFixed(2)} ms; samples ${samples.map((value) => value.toFixed(2)).join(", ")}`);
});

test("blocked dirty-cone geometry is byte-identical to a full recomputation", () => {
  const baseline = largePreviewBaseline();
  const preview = solveAreaMapGesture(baseline, { selectedAreas: ["root/n0"], handle: null, desiredWorldDelta: { x: 1_000, y: 20 } });
  const recomputed = computeWorldGeometry({ ...baseline, regions: preview.regions });
  assert.deepEqual(preview.geometry, recomputed);
});
