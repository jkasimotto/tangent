import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { SceneElement } from "../kernel/kernel-types.ts";
import { size } from "../units/frames.ts";
import type { Camera } from "../units/frames.ts";
import { scenePx, screenPx, zoom } from "../units/units.ts";
import { cameraForStrip, elementsBounds } from "./strip-camera.ts";

/** One rectangle element at a scene position. */
function element(id: string, x: number, y: number, width: number, height: number): SceneElement {
  return { id, type: "rectangle", x, y, width, height, isDeleted: false } as unknown as SceneElement;
}

const VIEWPORT = size("screen", screenPx(1280), screenPx(760));
/** A camera Excalidraw produced to fit a 400 by 200 box centred at (300, 200) into the whole viewport. */
const FITTED: Camera = { zoom: zoom(1), scrollX: scenePx(340), scrollY: scenePx(180) };
const BOX = [element("a", 100, 100, 200, 200), element("b", 300, 100, 200, 200)];

/** Where a scene point lands on screen under a camera. */
function screenX(camera: Camera, x: number): number {
  return (x + camera.scrollX) * camera.zoom;
}

test("elementsBounds is the union of every element rectangle, and null for none", () => {
  assert.deepEqual(elementsBounds(BOX), { x: 100, y: 100, width: 400, height: 200 });
  assert.equal(elementsBounds([]), null);
});

test("with no panel the fitted camera comes back unchanged", () => {
  assert.deepEqual(cameraForStrip(FITTED, BOX, VIEWPORT, screenPx(0)), FITTED);
});

test("with a panel the content is centred in the strip it leaves and fits inside it", () => {
  const inset = screenPx(600);
  const camera = cameraForStrip(FITTED, BOX, VIEWPORT, inset);
  const bounds = elementsBounds(BOX);
  assert.ok(bounds);
  const left = screenX(camera, bounds.x);
  const right = screenX(camera, bounds.x + bounds.width);
  const strip = VIEWPORT.width - inset;
  assert.ok(Math.abs((left + right) / 2 - strip / 2) < 0.01, `the content centre sits at the strip centre: ${left}..${right} in ${strip}`);
  assert.ok(right <= strip, `the content ends before the panel starts: ${right} <= ${strip}`);
  assert.ok(camera.zoom < FITTED.zoom, "the zoom shrinks by the strip's share of the width");
});
