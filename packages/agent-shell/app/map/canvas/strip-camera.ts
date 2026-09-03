// The camera that shows a set of elements in the strip of the Map the retained Resources panel
// leaves free. Excalidraw's own fit centres content on the whole canvas and knows nothing about
// the panel, so a fitted Area landed half behind it. This takes the camera Excalidraw produced
// for the whole Map and re-aims it at the strip: the zoom shrinks by the strip's share of the
// width, and the content centre moves to the strip's centre.

import type { Camera, Rect, Size } from "../units/frames.ts";
import type { SceneElement } from "../kernel/kernel-types.ts";
import { elementRect } from "../input/hit-test.ts";
import { rectCenter, union } from "../units/scalar-math.ts";
import { scenePx, screenPx, zoom } from "../units/units.ts";
import type { ScreenPx } from "../units/units.ts";

/** The smallest rectangle holding every element, or null for none. */
export function elementsBounds(elements: readonly SceneElement[]): Rect<"scene"> | null {
  let bounds: Rect<"scene"> | null = null;
  for (const element of elements) bounds = bounds === null ? elementRect(element) : union(bounds, elementRect(element));
  return bounds;
}

/** The width of the Map left free by the panel. */
export function stripWidth(viewport: Size<"screen">, inset: ScreenPx): ScreenPx {
  return screenPx(viewport.width - inset);
}

/**
 * Re-aims a camera that fits `elements` into the whole viewport so it fits them into the strip
 * left of a panel `inset` pixels wide instead. With no inset the camera comes back unchanged.
 */
export function cameraForStrip(fitted: Camera, elements: readonly SceneElement[], viewport: Size<"screen">, inset: ScreenPx): Camera {
  const bounds = elementsBounds(elements);
  if (inset <= 0 || bounds === null || viewport.width <= 0) return fitted;
  const strip = stripWidth(viewport, inset);
  const scale = zoom((fitted.zoom * strip) / viewport.width);
  const centre = rectCenter(bounds);
  return {
    zoom: scale,
    scrollX: scenePx(strip / (scale + scale) - centre.x),
    scrollY: scenePx(viewport.height / (scale + scale) - centre.y),
  };
}
