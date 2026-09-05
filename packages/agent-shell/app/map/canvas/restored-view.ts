// Whether the camera the Map restored on an open actually shows the world.
//
// The private view record keeps the camera between visits, which is what makes reopening the Map
// feel like coming back to where you left it. Nothing bounds a wheel pan, though, so the camera a
// person leaves behind can be tens of thousands of scene pixels past every Area, and replaying it
// verbatim opens the Map on an empty canvas with no Area, no pill and no way back but Excalidraw's
// own button. `viewShowsAnyArea` is the check the open makes before it trusts the saved camera: it
// turns the camera and the canvas size into the scene rectangle on screen and asks whether any
// Area a person could see has part of itself inside it.

import type { VisibleScene } from "../input/hit-test.ts";
import { isVisibleArea } from "../input/hit-test.ts";
import { rect } from "../units/frames.ts";
import type { Camera, Rect, Size } from "../units/frames.ts";
import { rectsOverlap, toSceneLength } from "../units/scalar-math.ts";
import { scenePx } from "../units/units.ts";

/** The scene rectangle a camera shows on a canvas of this size. The inverse of a fit. */
export function visibleSceneRect(camera: Camera, viewport: Size<"screen">): Rect<"scene"> {
  return rect(
    "scene",
    scenePx(-camera.scrollX),
    scenePx(-camera.scrollY),
    toSceneLength(viewport.width, camera.zoom),
    toSceneLength(viewport.height, camera.zoom),
  );
}

/**
 * True when at least one Area the restriction and the folds still draw has any part of it inside
 * what the camera shows. An unmeasured canvas has no answer, so it keeps the camera it was given:
 * only a measured empty view is evidence that the saved camera lost the world.
 */
export function viewShowsAnyArea(scene: VisibleScene, camera: Camera, viewport: Size<"screen">): boolean {
  if (viewport.width <= 0 || viewport.height <= 0) return true;
  const visible = visibleSceneRect(camera, viewport);
  for (const [area, bounds] of scene.regionRects) {
    if (isVisibleArea(scene, area) && rectsOverlap(visible, bounds)) return true;
  }
  return false;
}
