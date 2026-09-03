import { strict as assert } from "node:assert";
import { test } from "node:test";
import { point, rect, size } from "../units/frames.ts";
import type { Camera, Point, Rect, Size } from "../units/frames.ts";
import { areaKey } from "../units/ids.ts";
import type { AreaKey } from "../units/ids.ts";
import { rectContains } from "../units/scalar-math.ts";
import { scenePx, screenPx, zoom } from "../units/units.ts";
import { hiddenByFold } from "./hit-test.ts";
import type { VisibleScene } from "./hit-test.ts";
import { placementPoint, placementTarget, visibleSceneRect } from "./placement-point.ts";

// Property tests over random cameras, viewports, pointers and Area layouts. The generator is a
// seeded linear congruential generator so a failure reproduces from the printed seed.

const RUNS = 3000;
const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const MODULUS = 2 ** 32;
const SCROLL_RANGE = 20_000;
const POINTER_RANGE = 40_000;
const VIEWPORT_MAX = 4000;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;
const AREAS_MAX = 12;
const AREA_SIZE_MAX = 6000;
const AREA_SPREAD = 30_000;

/** A deterministic pseudo-random source in [0, 1). */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, MULTIPLIER) + INCREMENT) >>> 0;
    return state / MODULUS;
  };
}

/** A random number in [low, high). */
function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low);
}

/** A random camera: any scroll offset and a zoom well inside Excalidraw's range. */
function randomCamera(random: () => number): Camera {
  return {
    scrollX: scenePx(between(random, -SCROLL_RANGE, SCROLL_RANGE)),
    scrollY: scenePx(between(random, -SCROLL_RANGE, SCROLL_RANGE)),
    zoom: zoom(between(random, ZOOM_MIN, ZOOM_MAX))
  };
}

/** A random viewport, sometimes degenerate: a zero width or height must still yield a point inside it. */
function randomViewport(random: () => number): Size<"screen"> {
  const degenerate = random() < 0.05;
  return size("screen", screenPx(degenerate ? 0 : between(random, 0, VIEWPORT_MAX)), screenPx(degenerate ? 0 : between(random, 0, VIEWPORT_MAX)));
}

/** A random last pointer: absent, somewhere near the visible scene, or anywhere at all. */
function randomPointer(random: () => number, visible: Rect<"scene">): Point<"scene"> | null {
  const roll = random();
  if (roll < 0.2) return null;
  if (roll < 0.6) {
    return point("scene", scenePx(visible.x + between(random, -0.5, 1.5) * visible.width), scenePx(visible.y + between(random, -0.5, 1.5) * visible.height));
  }
  return point("scene", scenePx(between(random, -POINTER_RANGE, POINTER_RANGE)), scenePx(between(random, -POINTER_RANGE, POINTER_RANGE)));
}

/** A random Area region: anywhere in the scene, up to a large size, sometimes empty. */
function randomRegion(random: () => number): Rect<"scene"> {
  return rect("scene", scenePx(between(random, -AREA_SPREAD, AREA_SPREAD)), scenePx(between(random, -AREA_SPREAD, AREA_SPREAD)), scenePx(between(random, 0, AREA_SIZE_MAX)), scenePx(between(random, 0, AREA_SIZE_MAX)));
}

/**
 * A random visible scene: a nested Area tree of random regions, a random Only scope over them, and
 * random folded roots. Elements play no part in a placement target, so the scene holds none.
 */
function randomScene(random: () => number): VisibleScene {
  const regionRects = new Map<AreaKey, Rect<"scene">>();
  const scopedAreas = new Set<AreaKey>();
  const folded = new Set<AreaKey>();
  const total = 1 + Math.floor(random() * AREAS_MAX);
  let key = "root";
  for (let index = 0; index < total; index += 1) {
    key = random() < 0.5 ? `${key}/a${index}` : `root/b${index}`;
    const area = areaKey(key);
    regionRects.set(area, randomRegion(random));
    if (random() < 0.8) scopedAreas.add(area);
    if (random() < 0.2) folded.add(area);
  }
  return { elements: [], regionRects, hiddenIds: new Set(), scopedAreas, folded, zoom: zoom(between(random, ZOOM_MIN, ZOOM_MAX)) };
}

/** True when fold or scope has taken the Area off the canvas. */
function isHidden(scene: VisibleScene, area: AreaKey): boolean {
  return !scene.scopedAreas.has(area) || hiddenByFold(scene.folded, area);
}

/** Runs one property across many seeds and names the failing seed. */
function forEachSeed(property: (random: () => number, seed: number) => void): void {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    try {
      property(makeRandom(seed), seed);
    } catch (error) {
      throw new Error(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

test("the placement point is always inside the visible viewport", () => {
  forEachSeed((random) => {
    const camera = randomCamera(random);
    const viewport = randomViewport(random);
    const visible = visibleSceneRect(camera, viewport);
    const pointer = randomPointer(random, visible);
    const landed = placementPoint(camera, viewport, pointer);
    assert.ok(Number.isFinite(landed.x) && Number.isFinite(landed.y), `point is not finite: ${JSON.stringify(landed)}`);
    assert.ok(rectContains(visible, landed, scenePx(0)), `point ${JSON.stringify(landed)} outside viewport ${JSON.stringify(visible)}`);
  });
});

test("a pointer inside the viewport is kept and one outside is replaced by the centre", () => {
  forEachSeed((random) => {
    const camera = randomCamera(random);
    const viewport = randomViewport(random);
    const visible = visibleSceneRect(camera, viewport);
    const pointer = randomPointer(random, visible);
    const landed = placementPoint(camera, viewport, pointer);
    if (pointer !== null && rectContains(visible, pointer, scenePx(0))) {
      assert.deepEqual(landed, pointer, "an on-screen pointer is the placement point");
    } else {
      assert.deepEqual(landed, placementPoint(camera, viewport, null), "an off-screen or absent pointer lands at the viewport centre");
    }
  });
});

test("the placement target is never a hidden Area, always contains the point, and is the deepest such Area", () => {
  forEachSeed((random) => {
    const camera = randomCamera(random);
    const viewport = randomViewport(random);
    const scene = randomScene(random);
    const landed = placementPoint(camera, viewport, randomPointer(random, visibleSceneRect(camera, viewport)));
    const target = placementTarget(landed, scene);
    const visibleContaining = [...scene.regionRects].filter(([area, bounds]) => !isHidden(scene, area) && rectContains(bounds, landed, scenePx(0))).map(([area]) => area);
    if (target === null) {
      assert.deepEqual(visibleContaining, [], "a visible Area contains the point but nothing was targeted");
      return;
    }
    assert.ok(!isHidden(scene, target), `target ${target} is hidden by fold or scope`);
    assert.ok(visibleContaining.includes(target), `target ${target} does not contain the point`);
    const deepest = Math.max(...visibleContaining.map((area) => area.split("/").length));
    assert.equal(target.split("/").length, deepest, `target ${target} is not the deepest visible Area under the point`);
  });
});
