import { strict as assert } from "node:assert";
import { test } from "node:test";
import { count, index, milliseconds, ratio, scenePx, screenPx, sourcePx, zoom } from "./units.ts";
import type { Ratio, ScenePx, ScreenPx, Zoom } from "./units.ts";

test("every constructor returns the number it was given", () => {
  assert.equal(screenPx(12), 12);
  assert.equal(scenePx(-3.5), -3.5);
  assert.equal(sourcePx(0), 0);
  assert.equal(zoom(1.25), 1.25);
  assert.equal(milliseconds(1000), 1000);
  assert.equal(count(7), 7);
  assert.equal(index(0), 0);
  assert.equal(ratio(0.5), 0.5);
});

test("a branded scalar satisfies a number slot without a cast", () => {
  const width: ScreenPx = screenPx(10);
  assert.equal(Math.max(width, 4), 10);
  assert.equal(`${width}px`, "10px");
});

test("pixel units of different frames do not mix", () => {
  /** Accepts only scene pixels. */
  const takesScene = (value: ScenePx): ScenePx => value;
  // @ts-expect-error a screen pixel is not a scene pixel.
  takesScene(screenPx(1));
  assert.equal(takesScene(scenePx(1)), 1);
});

test("zoom and ratio are separate brands", () => {
  /** Accepts only a proportion. */
  const takesRatio = (value: Ratio): Ratio => value;
  /** Accepts only a zoom. */
  const takesZoom = (value: Zoom): Zoom => value;
  // @ts-expect-error a zoom is not a proportion.
  takesRatio(zoom(2));
  // @ts-expect-error a proportion is not a zoom.
  takesZoom(ratio(0.5));
  assert.equal(takesZoom(zoom(2)), 2);
});
