import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { VisibleScene } from "../input/hit-test.ts";
import { rect, size } from "../units/frames.ts";
import type { Camera, Rect } from "../units/frames.ts";
import { areaKey } from "../units/ids.ts";
import type { AreaKey } from "../units/ids.ts";
import { scenePx, screenPx, zoom } from "../units/units.ts";
import { visibleSceneRect, viewShowsAnyArea } from "./restored-view.ts";

const VIEWPORT = size("screen", screenPx(1440), screenPx(1000));

/** One Area region rectangle in the scene. */
function region(x: number, y: number, width: number, height: number): Rect<"scene"> {
  return rect("scene", scenePx(x), scenePx(y), scenePx(width), scenePx(height));
}

/** A camera at a scroll offset and a zoom, in the shape Excalidraw reports. */
function camera(scrollX: number, scrollY: number, level: number): Camera {
  return { scrollX: scenePx(scrollX), scrollY: scenePx(scrollY), zoom: zoom(level) };
}

/** A visible scene of Area regions, with the restriction and the folds it is judged under. */
function scene(regions: ReadonlyArray<readonly [string, Rect<"scene">]>, scoped: readonly string[], folded: readonly string[] = []): VisibleScene {
  const rects = new Map<AreaKey, Rect<"scene">>(regions.map(([area, bounds]) => [areaKey(area), bounds]));
  return {
    elements: [],
    regionRects: rects,
    hiddenIds: new Set(),
    scopedAreas: new Set(scoped.map((area) => areaKey(area))),
    folded: new Set(folded.map((area) => areaKey(area))),
    zoom: zoom(1),
  };
}

const WORLD = scene([["otto", region(0, 0, 1600, 1040)], ["otto/tangent", region(120, 120, 1000, 760)]], ["otto", "otto/tangent"]);

test("the visible scene rectangle is the canvas seen through the camera", () => {
  assert.deepEqual(visibleSceneRect(camera(-100, -6916, 0.5), VIEWPORT), { x: 100, y: 6916, width: 2880, height: 2000 });
});

test("a camera over the world shows Areas", () => {
  assert.equal(viewShowsAnyArea(WORLD, camera(0, 0, 1), VIEWPORT), true);
});

test("a camera the wheel carried far past every Area shows none", () => {
  assert.equal(viewShowsAnyArea(WORLD, camera(-81, -33316, 0.5), VIEWPORT), false);
});

test("an Area touched by one edge of the view still counts as shown", () => {
  assert.equal(viewShowsAnyArea(WORLD, camera(-1599, 0, 1), VIEWPORT), true);
  assert.equal(viewShowsAnyArea(WORLD, camera(-1600, 0, 1), VIEWPORT), false);
});

test("an Area the restriction excludes does not count, so a camera over it alone shows none", () => {
  const restricted = scene([["otto", region(0, 0, 1600, 1040)], ["far", region(9000, 9000, 400, 400)]], ["far"]);
  assert.equal(viewShowsAnyArea(restricted, camera(0, 0, 1), VIEWPORT), false);
  assert.equal(viewShowsAnyArea(restricted, camera(-9000, -9000, 1), VIEWPORT), true);
});

test("a folded Area's hidden descendant does not count as shown", () => {
  const folds = scene([["otto", region(0, 0, 400, 400)], ["otto/tangent", region(9000, 9000, 400, 400)]], ["otto", "otto/tangent"], ["otto"]);
  assert.equal(viewShowsAnyArea(folds, camera(-9000, -9000, 1), VIEWPORT), false);
  assert.equal(viewShowsAnyArea(folds, camera(0, 0, 1), VIEWPORT), true);
});

test("an unmeasured canvas keeps the camera it was given, because it is no evidence of an empty view", () => {
  assert.equal(viewShowsAnyArea(WORLD, camera(-81, -33316, 0.5), size("screen", screenPx(0), screenPx(0))), true);
});
