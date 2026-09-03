// Where B, paste and Place land. The old component placed at the last pointer point wherever it
// was, so after a pan a new Block could land in an Area that had scrolled off screen (audit defect
// 9), and it chose the Area by a containment test over every region, hidden ones included (defect
// 3). Here the point is derived from the camera: the last pointer point when it is still inside
// the visible viewport, otherwise the viewport centre, so the answer is always on screen. The
// target Area is the deepest visible Area `hit-test.ts` names at that point, so a hidden Area can
// never be the target. `placement-point.property.test.ts` proves both.

import { point, rect } from "../units/frames.ts";
import type { Camera, Point, Rect, Size } from "../units/frames.ts";
import type { AreaKey } from "../units/ids.ts";
import { rectCenter, rectContains, subtract, toScene } from "../units/scalar-math.ts";
import { scenePx, screenPx } from "../units/units.ts";
import { deepestVisibleArea } from "./hit-test.ts";
import type { VisibleScene } from "./hit-test.ts";

/** The part of the scene the camera shows: the screen viewport carried into the scene frame. */
export function visibleSceneRect(camera: Camera, viewport: Size<"screen">): Rect<"scene"> {
  const origin = toScene(point("screen", screenPx(0), screenPx(0)), camera);
  const corner = toScene(point("screen", viewport.width, viewport.height), camera);
  return rect("scene", origin.x, origin.y, subtract(corner.x, origin.x), subtract(corner.y, origin.y));
}

/**
 * The scene point a placement lands at: the last pointer point when it is inside the visible
 * viewport, otherwise the viewport centre. The result is always inside the viewport.
 */
export function placementPoint(camera: Camera, viewport: Size<"screen">, lastPointer: Point<"scene"> | null): Point<"scene"> {
  const visible = visibleSceneRect(camera, viewport);
  if (lastPointer !== null && rectContains(visible, lastPointer, scenePx(0))) return lastPointer;
  return rectCenter(visible);
}

/**
 * The Area a placement lands in: the deepest visible Area under the point, from the one hit test,
 * or null when the point is over no visible Area. The caller falls back to the located Area for
 * null, which is never hidden because it is the Area the Map is viewed from.
 */
export function placementTarget(target: Point<"scene">, scene: VisibleScene): AreaKey | null {
  return deepestVisibleArea(scene, target);
}
