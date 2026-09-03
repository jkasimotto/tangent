// Brand-preserving math over the scalars in `units.ts` and the shapes in `frames.ts`.
//
// Arithmetic drops a brand: `a + b` of two `ScenePx` is a plain number. Every function here does the
// arithmetic and re-brands the result, so a consumer never spells `number` and never hand-rolls a
// `Math.min(Math.max(...))` beside its first caller. Two frames are crossed only here: `toScene`
// and `toScreen` are the one place the camera conversion is written.
//
// Every function over two shapes takes its frame from the first argument and marks the rest
// `NoInfer`, so mixing a scene rect with a screen point is a compile error instead of a widened
// union frame.

import type { Camera, Delta, Frame, PixelOf, Point, Rect } from "./frames.ts";
import type { Ratio, ScenePx, ScreenPx, Zoom } from "./units.ts";

/** Adds two like-branded scalars and keeps the brand. */
export function add<T extends number>(left: T, right: T): T {
  return (left + right) as T;
}

/** Subtracts `right` from `left` and keeps the brand. */
export function subtract<T extends number>(left: T, right: T): T {
  return (left - right) as T;
}

/** Multiplies a branded scalar by a proportion and keeps the brand. A pixel scaled by a ratio is still that pixel unit. */
export function scale<T extends number>(value: T, factor: Ratio): T {
  return (value * factor) as T;
}

/** Clamps `value` into `[min, max]` and keeps the brand: an Index stays an Index, a Ratio a Ratio. */
export function clamp<T extends number>(value: T, min: T, max: T): T {
  return Math.min(Math.max(value, min), max) as T;
}

/** The point halfway between two points of one frame. */
export function midpoint<F extends Frame>(left: Point<F>, right: NoInfer<Point<F>>): Point<F> {
  return rebrandPoint((left.x + right.x) / 2, (left.y + right.y) / 2);
}

/** The straight-line distance between two points of one frame, in that frame's pixel unit. */
export function distance<F extends Frame>(left: Point<F>, right: NoInfer<Point<F>>): PixelOf<F> {
  return Math.hypot(right.x - left.x, right.y - left.y) as PixelOf<F>;
}

/** Moves a point by a displacement of the same frame. */
export function translate<F extends Frame>(origin: Point<F>, offset: NoInfer<Delta<F>>): Point<F> {
  return rebrandPoint(origin.x + offset.dx, origin.y + offset.dy);
}

/** The displacement that carries `from` onto `to`. */
export function deltaBetween<F extends Frame>(from: Point<F>, to: NoInfer<Point<F>>): Delta<F> {
  return { dx: to.x - from.x, dy: to.y - from.y } as Delta<F>;
}

/** The centre of a rectangle. */
export function rectCenter<F extends Frame>(bounds: Rect<F>): Point<F> {
  return rebrandPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

/**
 * True when the point lies inside the rectangle grown by `padding` on every side. The edges count
 * as inside, so a point on the border hits. A negative padding shrinks the hit area.
 */
export function rectContains<F extends Frame>(bounds: Rect<F>, target: NoInfer<Point<F>>, padding: NoInfer<PixelOf<F>>): boolean {
  return target.x >= bounds.x - padding
    && target.x <= bounds.x + bounds.width + padding
    && target.y >= bounds.y - padding
    && target.y <= bounds.y + bounds.height + padding;
}

/** True when two rectangles of one frame share any area. Touching edges do not overlap. */
export function rectsOverlap<F extends Frame>(left: Rect<F>, right: NoInfer<Rect<F>>): boolean {
  return left.x < right.x + right.width
    && right.x < left.x + left.width
    && left.y < right.y + right.height
    && right.y < left.y + left.height;
}

/** Grows a rectangle by `amount` on every side. A negative amount shrinks it. */
export function inflate<F extends Frame>(bounds: Rect<F>, amount: NoInfer<PixelOf<F>>): Rect<F> {
  return rebrandRect(bounds.x - amount, bounds.y - amount, bounds.width + amount * 2, bounds.height + amount * 2);
}

/** The smallest rectangle that covers both rectangles. */
export function union<F extends Frame>(left: Rect<F>, right: NoInfer<Rect<F>>): Rect<F> {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return rebrandRect(x, y, rightEdge - x, bottomEdge - y);
}

/**
 * Converts a canvas-relative screen point into the scene the camera is looking at. This is the
 * one place the conversion is written: a screen pixel is divided by the zoom and the scroll offset
 * is removed, which is how Excalidraw maps a pointer event onto its world.
 */
export function toScene(screenPoint: Point<"screen">, camera: Camera): Point<"scene"> {
  return rebrandPoint(screenPoint.x / camera.zoom - camera.scrollX, screenPoint.y / camera.zoom - camera.scrollY);
}

/**
 * Converts a screen length into the scene length it covers at a zoom. A grab padding is authored
 * in screen pixels so it feels the same at every zoom; dividing by the zoom is how it reaches the
 * scene, and this is the one place that division is written.
 */
export function toSceneLength(length: ScreenPx, zoom: Zoom): ScenePx {
  return (length / zoom) as ScenePx;
}

/** Converts a scene point into the canvas-relative screen point the camera shows it at. The inverse of `toScene`. */
export function toScreen(scenePoint: Point<"scene">, camera: Camera): Point<"screen"> {
  return rebrandPoint((scenePoint.x + camera.scrollX) * camera.zoom, (scenePoint.y + camera.scrollY) * camera.zoom);
}

/** Re-brands computed coordinates as a point of the caller's frame. The one cast behind every point result here. */
function rebrandPoint<F extends Frame>(x: number, y: number): Point<F> {
  return { x, y } as Point<F>;
}

/** Re-brands computed coordinates as a rectangle of the caller's frame. The one cast behind every rectangle result here. */
function rebrandRect<F extends Frame>(x: number, y: number, width: number, height: number): Rect<F> {
  return { x, y, width, height } as Rect<F>;
}
