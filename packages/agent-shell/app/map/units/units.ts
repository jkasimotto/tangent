// The scalar brands of the Map: the unit and the meaning a bare number would lose.
//
// A raw `number` says nothing about what it measures, so one slot would accept a screen pixel, a
// zoom factor, a list index and a timeout interchangeably. These brands give every scalar a
// compile-time identity. Branding is compile-time only: at runtime each value is exactly its
// number. Arithmetic drops the brand, so a result is re-branded at the boundary with the matching
// constructor, or through `scalar-math.ts` which keeps the brand for you. The constructors here are
// the one place a raw number is named; consumers never spell `number` themselves.

import type { Brand } from "./brand.ts";

/** A CSS pixel from a pointer event or a DOM rect, relative to the canvas. The unit of the `screen` frame. */
export type ScreenPx = Brand<number, "ScreenPx">;

/** A pixel in Excalidraw's composed world, after the kernel's composition. The unit of the `scene` frame. */
export type ScenePx = Brand<number, "ScenePx">;

/** A shard-local pixel, what the vault stores for one owner's elements. The unit of the `source` frame. */
export type SourcePx = Brand<number, "SourcePx">;

/**
 * The camera's magnification: how many screen pixels one scene pixel covers. A ratio by meaning, but
 * its own brand so a zoom cannot be handed where a proportion is wanted and a proportion cannot be
 * handed to the camera. Brands do not nest (see `brand.ts`), so it is not a `Brand<Ratio, ...>`.
 */
export type Zoom = Brand<number, "Zoom">;

/** A duration that feeds a timer or a settle window directly: the paste window, the pointer settle, the resource cadence. */
export type Milliseconds = Brand<number, "Milliseconds">;

/** A cardinality: how many of something, such as a list window or a region count. */
export type Count = Brand<number, "Count">;

/** A zero-based position into a sequence, such as a Find position. Distinct from a cardinality. */
export type Index = Brand<number, "Index">;

/** A normalized fraction, conventionally in [0, 1]: an interpolation parameter or a proportion. */
export type Ratio = Brand<number, "Ratio">;

/** A share out of one hundred, the way Excalidraw measures an element's opacity. Its own brand so it never passes for a `Ratio`. */
export type Percent = Brand<number, "Percent">;

/** Tags a raw number as a screen pixel. */
export function screenPx(value: number): ScreenPx {
  return value as ScreenPx;
}

/** Tags a raw number as a scene pixel. */
export function scenePx(value: number): ScenePx {
  return value as ScenePx;
}

/** Tags a raw number as a source pixel. */
export function sourcePx(value: number): SourcePx {
  return value as SourcePx;
}

/** Tags a raw number as a camera zoom factor. */
export function zoom(value: number): Zoom {
  return value as Zoom;
}

/** Tags a raw number as a duration in milliseconds. */
export function milliseconds(value: number): Milliseconds {
  return value as Milliseconds;
}

/** Tags a raw number as a cardinality. */
export function count(value: number): Count {
  return value as Count;
}

/** Tags a raw number as a sequence index. */
export function index(value: number): Index {
  return value as Index;
}

/** Tags a raw number as a normalized fraction. */
export function ratio(value: number): Ratio {
  return value as Ratio;
}

/** Tags a raw number as a share out of one hundred. */
export function percent(value: number): Percent {
  return value as Percent;
}
