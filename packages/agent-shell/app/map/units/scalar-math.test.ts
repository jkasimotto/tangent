import { strict as assert } from "node:assert";
import { test } from "node:test";
import { delta, point, rect } from "./frames.ts";
import type { Camera, Point, Rect } from "./frames.ts";
import {
  add, clamp, deltaBetween, distance, inflate, midpoint, rectCenter, rectContains, rectsOverlap, scale, subtract, toScene, toSceneLength, toScreen, translate, union,
} from "./scalar-math.ts";
import { index, ratio, scenePx, screenPx, zoom } from "./units.ts";
import type { Index, ScenePx } from "./units.ts";

/** A scene point from raw test numbers. */
const sp = (x: number, y: number): Point<"scene"> => point("scene", scenePx(x), scenePx(y));

/** A scene rect from raw test numbers. */
const sr = (x: number, y: number, width: number, height: number): Rect<"scene"> => rect("scene", scenePx(x), scenePx(y), scenePx(width), scenePx(height));

test("scalar arithmetic keeps the brand", () => {
  const sum: ScenePx = add(scenePx(2), scenePx(3));
  assert.equal(sum, 5);
  const difference: ScenePx = subtract(scenePx(2), scenePx(3));
  assert.equal(difference, -1);
  const scaled: ScenePx = scale(scenePx(10), ratio(0.25));
  assert.equal(scaled, 2.5);
  const next: Index = add(index(4), index(1));
  assert.equal(next, 5);
  // @ts-expect-error two different brands cannot be added.
  add(scenePx(1), screenPx(1));
});

test("clamp bounds a value and keeps the brand", () => {
  const clamped: Index = clamp(index(9), index(0), index(4));
  assert.equal(clamped, 4);
  assert.equal(clamp(index(-2), index(0), index(4)), 0);
  assert.equal(clamp(index(2), index(0), index(4)), 2);
});

test("midpoint, distance, translate and deltaBetween work in one frame", () => {
  assert.deepEqual(midpoint(sp(0, 0), sp(4, 6)), { x: 2, y: 3 });
  assert.equal(distance(sp(0, 0), sp(3, 4)), 5);
  assert.deepEqual(translate(sp(1, 1), delta("scene", scenePx(2), scenePx(-3))), { x: 3, y: -2 });
  assert.deepEqual(deltaBetween(sp(1, 1), sp(3, -2)), { dx: 2, dy: -3 });
  assert.deepEqual(translate(sp(1, 1), deltaBetween(sp(1, 1), sp(9, 9))), { x: 9, y: 9 });
  // @ts-expect-error points of different frames cannot be measured against each other.
  distance(sp(0, 0), point("screen", screenPx(1), screenPx(1)));
  // @ts-expect-error a screen displacement cannot move a scene point.
  translate(sp(0, 0), delta("screen", screenPx(1), screenPx(1)));
});

test("rectContains honours the edges and the padding", () => {
  const bounds = sr(10, 10, 20, 10);
  assert.ok(rectContains(bounds, sp(10, 10), scenePx(0)));
  assert.ok(rectContains(bounds, sp(30, 20), scenePx(0)));
  assert.ok(rectContains(bounds, sp(15, 15), scenePx(0)));
  assert.equal(rectContains(bounds, sp(31, 15), scenePx(0)), false);
  assert.equal(rectContains(bounds, sp(9, 15), scenePx(0)), false);
  assert.ok(rectContains(bounds, sp(31, 15), scenePx(1)));
  assert.equal(rectContains(bounds, sp(10, 10), scenePx(-1)), false);
  // @ts-expect-error a screen point cannot be tested against a scene rect.
  rectContains(bounds, point("screen", screenPx(15), screenPx(15)), scenePx(0));
  // @ts-expect-error the padding must carry the rect's pixel unit.
  rectContains(bounds, sp(15, 15), screenPx(0));
});

test("rectsOverlap is false for touching edges and true for shared area", () => {
  assert.ok(rectsOverlap(sr(0, 0, 10, 10), sr(5, 5, 10, 10)));
  assert.ok(rectsOverlap(sr(0, 0, 10, 10), sr(2, 2, 3, 3)));
  assert.equal(rectsOverlap(sr(0, 0, 10, 10), sr(10, 0, 10, 10)), false);
  assert.equal(rectsOverlap(sr(0, 0, 10, 10), sr(0, 10, 10, 10)), false);
  assert.equal(rectsOverlap(sr(0, 0, 10, 10), sr(20, 20, 1, 1)), false);
  // @ts-expect-error rects of different frames cannot overlap.
  rectsOverlap(sr(0, 0, 10, 10), rect("screen", screenPx(0), screenPx(0), screenPx(1), screenPx(1)));
});

test("inflate, union and rectCenter", () => {
  assert.deepEqual(inflate(sr(10, 10, 20, 10), scenePx(2)), { x: 8, y: 8, width: 24, height: 14 });
  assert.deepEqual(inflate(sr(10, 10, 20, 10), scenePx(-2)), { x: 12, y: 12, width: 16, height: 6 });
  assert.deepEqual(union(sr(0, 0, 10, 10), sr(5, 5, 10, 10)), { x: 0, y: 0, width: 15, height: 15 });
  assert.deepEqual(union(sr(0, 0, 1, 1), sr(-5, 20, 2, 2)), { x: -5, y: 0, width: 6, height: 22 });
  assert.deepEqual(rectCenter(sr(10, 10, 20, 10)), { x: 20, y: 15 });
});

test("toScene matches the old eventScenePoint formula and toScreen inverts it", () => {
  const camera: Camera = { scrollX: scenePx(100), scrollY: scenePx(-50), zoom: zoom(2) };
  const screen = point("screen", screenPx(300), screenPx(40));
  const scene = toScene(screen, camera);
  assert.deepEqual(scene, { x: 300 / 2 - 100, y: 40 / 2 + 50 });
  assert.deepEqual(toScreen(scene, camera), { x: 300, y: 40 });
  const identity: Camera = { scrollX: scenePx(0), scrollY: scenePx(0), zoom: zoom(1) };
  assert.deepEqual(toScene(point("screen", screenPx(7), screenPx(8)), identity), { x: 7, y: 8 });
  // @ts-expect-error a scene point cannot be converted to scene again.
  toScene(scene, camera);
});

test("toSceneLength divides a screen length by the zoom and brands it scene", () => {
  const padding: ScenePx = toSceneLength(screenPx(10), zoom(2));
  assert.equal(padding, 5);
  assert.equal(toSceneLength(screenPx(10), zoom(0.5)), 20);
  // @ts-expect-error a scene length is not a screen length.
  toSceneLength(scenePx(10), zoom(1));
});
