import { strict as assert } from "node:assert";
import { test } from "node:test";
import { delta, point, rect, size } from "./frames.ts";
import type { Camera, Point, Rect } from "./frames.ts";
import { scenePx, screenPx, sourcePx, zoom } from "./units.ts";

test("constructors build plain shapes with no runtime frame", () => {
  assert.deepEqual(point("screen", screenPx(1), screenPx(2)), { x: 1, y: 2 });
  assert.deepEqual(delta("scene", scenePx(3), scenePx(4)), { dx: 3, dy: 4 });
  assert.deepEqual(size("source", sourcePx(5), sourcePx(6)), { width: 5, height: 6 });
  assert.deepEqual(rect("scene", scenePx(1), scenePx(2), scenePx(3), scenePx(4)), { x: 1, y: 2, width: 3, height: 4 });
});

test("a constructor requires the pixel unit of its frame", () => {
  // @ts-expect-error a screen pixel cannot build a scene point.
  point("scene", screenPx(1), screenPx(2));
  // @ts-expect-error a source pixel cannot build a screen rect.
  rect("screen", sourcePx(0), sourcePx(0), sourcePx(1), sourcePx(1));
  assert.ok(true);
});

test("points and rects of different frames do not mix", () => {
  /** Accepts only a scene point. */
  const takesScenePoint = (value: Point<"scene">): Point<"scene"> => value;
  /** Accepts only a source rect. */
  const takesSourceRect = (value: Rect<"source">): Rect<"source"> => value;
  // @ts-expect-error a screen point is not a scene point.
  takesScenePoint(point("screen", screenPx(1), screenPx(2)));
  // @ts-expect-error a scene rect is not a source rect.
  takesSourceRect(rect("scene", scenePx(0), scenePx(0), scenePx(1), scenePx(1)));
  assert.deepEqual(takesScenePoint(point("scene", scenePx(1), scenePx(2))), { x: 1, y: 2 });
});

test("a point is not a delta and a size is not a rect", () => {
  /** Accepts only a scene point. */
  const takesScenePoint = (value: Point<"scene">): Point<"scene"> => value;
  // @ts-expect-error a displacement is not a position.
  takesScenePoint(delta("scene", scenePx(1), scenePx(2)));
  assert.ok(true);
});

test("a camera holds scene scroll and a zoom", () => {
  const camera: Camera = { scrollX: scenePx(10), scrollY: scenePx(20), zoom: zoom(2) };
  assert.deepEqual(camera, { scrollX: 10, scrollY: 20, zoom: 2 });
});
