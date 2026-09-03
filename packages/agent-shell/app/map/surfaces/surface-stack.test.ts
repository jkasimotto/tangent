import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  EMPTY_SURFACE_STACK, backStep, closeSurface, escape, hasModalSurface, isSurfaceOpen, openSurface,
  reduceSurfaceStack, topSurface
} from "./surface-stack.ts";
import type { SurfaceStack } from "./surface-stack.ts";

test("the empty stack has no top and no modal", () => {
  assert.equal(topSurface(EMPTY_SURFACE_STACK), null);
  assert.equal(hasModalSurface(EMPTY_SURFACE_STACK), false);
  assert.equal(isSurfaceOpen(EMPTY_SURFACE_STACK, "help"), false);
});

test("open pushes on top and never mutates the input", () => {
  const first = openSurface(EMPTY_SURFACE_STACK, "resources");
  const second = openSurface(first, "resourceDetails");
  assert.deepEqual(first, ["resources"]);
  assert.deepEqual(second, ["resources", "resourceDetails"]);
  assert.equal(topSurface(second), "resourceDetails");
  assert.equal(EMPTY_SURFACE_STACK.length, 0);
});

test("opening an open surface returns the same stack", () => {
  const stack = openSurface(EMPTY_SURFACE_STACK, "find");
  assert.equal(openSurface(stack, "find"), stack);
});

test("a modal replaces the modal on its layer", () => {
  const withPicker = openSurface(openSurface(EMPTY_SURFACE_STACK, "resources"), "picker");
  const withHelp = openSurface(withPicker, "help");
  assert.deepEqual(withHelp, ["resources", "help"]);
  assert.equal(hasModalSurface(withHelp), true);
});

test("close removes the surface and everything opened above it", () => {
  const stack: SurfaceStack = ["resources", "resourceDetails", "picker"];
  assert.deepEqual(closeSurface(stack, "resources"), []);
  assert.deepEqual(closeSurface(stack, "resourceDetails"), ["resources"]);
  assert.deepEqual(closeSurface(stack, "picker"), ["resources", "resourceDetails"]);
  assert.equal(closeSurface(stack, "help"), stack);
});

test("back-step pops the top and leaves the parent open", () => {
  const stack: SurfaceStack = ["resources", "resourceDetails"];
  assert.deepEqual(backStep(stack), ["resources"]);
  assert.equal(backStep(EMPTY_SURFACE_STACK), EMPTY_SURFACE_STACK);
});

test("escape pops the top and names it", () => {
  const stack: SurfaceStack = ["resources", "resourceDetails"];
  const result = escape(stack);
  assert.equal(result.closed, "resourceDetails");
  assert.deepEqual(result.stack, ["resources"]);
});

test("escape on an empty stack is back and changes nothing", () => {
  const result = escape(EMPTY_SURFACE_STACK);
  assert.equal(result.closed, "back");
  assert.equal(result.stack, EMPTY_SURFACE_STACK);
});

test("escape passes over the toast and closes the surface under it", () => {
  const stack: SurfaceStack = ["find", "transaction"];
  const result = escape(stack);
  assert.equal(result.closed, "find");
  assert.deepEqual(result.stack, ["transaction"]);
  const onlyToast = escape(["transaction"]);
  assert.equal(onlyToast.closed, "back");
  assert.deepEqual(onlyToast.stack, ["transaction"]);
});

test("the reducer routes every action", () => {
  let stack = reduceSurfaceStack(EMPTY_SURFACE_STACK, { type: "open", id: "resources" });
  stack = reduceSurfaceStack(stack, { type: "open", id: "resourceDetails" });
  assert.deepEqual(stack, ["resources", "resourceDetails"]);
  stack = reduceSurfaceStack(stack, { type: "back-step" });
  assert.deepEqual(stack, ["resources"]);
  stack = reduceSurfaceStack(stack, { type: "open", id: "help" });
  stack = reduceSurfaceStack(stack, { type: "escape" });
  assert.deepEqual(stack, ["resources"]);
  stack = reduceSurfaceStack(stack, { type: "close", id: "resources" });
  assert.deepEqual(stack, []);
});
