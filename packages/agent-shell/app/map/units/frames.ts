// The frames of reference the Map reasons in, as compile-time-distinct shapes.
//
// Every spatial value belongs to exactly one frame, and the frame brand keeps a point from one
// frame out of a slot that expects another. The three frames are the kernel's three coordinate
// spaces:
//
//   screen   CSS pixels relative to the canvas, what a pointer event reports.
//   scene    Excalidraw's world after the kernel composes every shard, what the camera looks at.
//   source   shard-local pixels, what the vault stores for one owner.
//
// `scalar-math.ts` owns the conversions between them. Only `toScene` and `toScreen` cross the
// screen and scene frames, and the kernel boundary is the only place source becomes scene.

import type { Brand } from "./brand.ts";
import type { ScenePx, ScreenPx, SourcePx, Zoom } from "./units.ts";

/** The pixel unit each frame measures in. The frame names are the keys so `Frame` derives from it. */
export type FramePixels = {
  screen: ScreenPx;
  scene: ScenePx;
  source: SourcePx;
};

/** The three frames of reference. */
export type Frame = keyof FramePixels;

/** The pixel unit of one frame: `ScreenPx` for `screen`, `ScenePx` for `scene`, `SourcePx` for `source`. */
export type PixelOf<F extends Frame> = FramePixels[F];

/** A position in one frame. */
export type Point<F extends Frame> = Brand<{ readonly x: PixelOf<F>; readonly y: PixelOf<F> }, `Point:${F}`>;

/** A displacement in one frame: the difference of two points, never a position. */
export type Delta<F extends Frame> = Brand<{ readonly dx: PixelOf<F>; readonly dy: PixelOf<F> }, `Delta:${F}`>;

/** An extent in one frame, with no position. */
export type Size<F extends Frame> = Brand<{ readonly width: PixelOf<F>; readonly height: PixelOf<F> }, `Size:${F}`>;

/** An axis-aligned rectangle in one frame: its top-left corner and its extent. */
export type Rect<F extends Frame> = Brand<
  { readonly x: PixelOf<F>; readonly y: PixelOf<F>; readonly width: PixelOf<F>; readonly height: PixelOf<F> },
  `Rect:${F}`
>;

/**
 * The camera Excalidraw reports through `onScrollChange`: the scroll offset in scene pixels and the
 * zoom. `toScene` and `toScreen` in `scalar-math.ts` are the only readers that do arithmetic on it.
 */
export type Camera = {
  readonly scrollX: ScenePx;
  readonly scrollY: ScenePx;
  readonly zoom: Zoom;
};

/**
 * Builds a point in the named frame. The frame is an argument because TypeScript cannot recover a
 * frame from a pixel brand alone, so `point("scene", x, y)` is the one way to say which frame a
 * point belongs to and the compiler then requires `x` and `y` to carry that frame's pixel unit.
 */
export function point<F extends Frame>(frame: F, x: PixelOf<F>, y: PixelOf<F>): Point<F> {
  return brandShape(frame, { x, y }) as Point<F>;
}

/** Builds a displacement in the named frame. */
export function delta<F extends Frame>(frame: F, dx: PixelOf<F>, dy: PixelOf<F>): Delta<F> {
  return brandShape(frame, { dx, dy }) as Delta<F>;
}

/** Builds an extent in the named frame. */
export function size<F extends Frame>(frame: F, width: PixelOf<F>, height: PixelOf<F>): Size<F> {
  return brandShape(frame, { width, height }) as Size<F>;
}

/** Builds a rectangle in the named frame from its top-left corner and extent. */
export function rect<F extends Frame>(frame: F, x: PixelOf<F>, y: PixelOf<F>, width: PixelOf<F>, height: PixelOf<F>): Rect<F> {
  return brandShape(frame, { x, y, width, height }) as Rect<F>;
}

/**
 * Returns the shape unchanged. The frame argument exists only so the constructors above can bind
 * their type parameter from a value; nothing about the frame is stored at runtime.
 */
function brandShape<S extends object>(_frame: Frame, shape: S): S {
  return shape;
}
