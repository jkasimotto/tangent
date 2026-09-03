import { strict as assert } from "node:assert";
import { test } from "node:test";
import { point, rect, size } from "../units/frames.ts";
import type { Camera, Rect } from "../units/frames.ts";
import { areaKey } from "../units/ids.ts";
import type { AreaKey } from "../units/ids.ts";
import { scenePx, screenPx, zoom } from "../units/units.ts";
import type { VisibleScene } from "./hit-test.ts";
import { placementPoint, placementTarget, visibleSceneRect } from "./placement-point.ts";

const CAMERA: Camera = { scrollX: scenePx(-1000), scrollY: scenePx(-500), zoom: zoom(2) };
const VIEWPORT = size("screen", screenPx(800), screenPx(600));

test("the visible scene rect is the viewport carried through the camera", () => {
  assert.deepEqual(visibleSceneRect(CAMERA, VIEWPORT), { x: 1000, y: 500, width: 400, height: 300 });
});

test("a last pointer inside the viewport is the placement point", () => {
  const pointer = point("scene", scenePx(1200), scenePx(600));
  assert.deepEqual(placementPoint(CAMERA, VIEWPORT, pointer), pointer);
});

test("a last pointer that panned off screen gives way to the viewport centre", () => {
  const offScreen = point("scene", scenePx(10), scenePx(10));
  assert.deepEqual(placementPoint(CAMERA, VIEWPORT, offScreen), { x: 1200, y: 650 });
  assert.deepEqual(placementPoint(CAMERA, VIEWPORT, null), { x: 1200, y: 650 });
});

test("a pointer on the viewport edge still counts as inside", () => {
  const edge = point("scene", scenePx(1400), scenePx(800));
  assert.deepEqual(placementPoint(CAMERA, VIEWPORT, edge), edge);
});

/** A visible scene of three nested Areas covering the same corner, with the given ones folded or scoped out. */
function nestedScene(options: { folded?: AreaKey[]; scoped?: AreaKey[] } = {}): VisibleScene {
  const bounds: Rect<"scene"> = rect("scene", scenePx(1000), scenePx(500), scenePx(400), scenePx(300));
  const areas = [areaKey("otto"), areaKey("otto/tangent"), areaKey("otto/tangent/map")];
  return {
    elements: [],
    regionRects: new Map(areas.map((area) => [area, bounds])),
    hiddenIds: new Set(),
    scopedAreas: new Set(options.scoped ?? areas),
    folded: new Set(options.folded ?? []),
    zoom: zoom(1)
  };
}

test("the placement target is the deepest visible Area under the point", () => {
  const target = point("scene", scenePx(1200), scenePx(650));
  assert.equal(placementTarget(target, nestedScene()), areaKey("otto/tangent/map"));
  assert.equal(placementTarget(target, nestedScene({ folded: [areaKey("otto/tangent")] })), areaKey("otto/tangent"), "a folded root is drawn, its descendants are not");
  assert.equal(placementTarget(target, nestedScene({ folded: [areaKey("otto")] })), areaKey("otto"));
  assert.equal(placementTarget(target, nestedScene({ scoped: [areaKey("otto")] })), areaKey("otto"), "Only keeps the target inside the scope");
  assert.equal(placementTarget(point("scene", scenePx(10), scenePx(10)), nestedScene()), null, "outside every region there is no target");
});
