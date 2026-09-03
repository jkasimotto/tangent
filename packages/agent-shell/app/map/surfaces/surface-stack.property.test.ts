import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SURFACES, SURFACE_IDS, isModalSurface } from "./surface-registry.ts";
import type { SurfaceId } from "./surface-registry.ts";
import { EMPTY_SURFACE_STACK, backStep, escape, openSurface, reduceSurfaceStack } from "./surface-stack.ts";
import type { SurfaceStack, SurfaceStackAction } from "./surface-stack.ts";

// Property tests over random action sequences. The generator is a seeded linear congruential
// generator so a failure reproduces from the printed seed.

const RUNS = 2000;
const MAX_ACTIONS = 24;
const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const MODULUS = 2 ** 32;

/** A deterministic pseudo-random source. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, MULTIPLIER) + INCREMENT) >>> 0;
    return state / MODULUS;
  };
}

/** One random element of a non-empty list. */
function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error("pick needs a non-empty list");
  return value;
}

/** One random action. */
function randomAction(random: () => number): SurfaceStackAction {
  const kind = pick(random, ["open", "open", "open", "close", "back-step", "escape"] as const);
  if (kind === "open" || kind === "close") return { type: kind, id: pick(random, SURFACE_IDS) };
  return { type: kind };
}

/** A random stack reached by applying random actions to the empty stack. */
function randomStack(random: () => number): SurfaceStack {
  let stack = EMPTY_SURFACE_STACK;
  const steps = Math.floor(random() * MAX_ACTIONS);
  for (let step = 0; step < steps; step += 1) stack = reduceSurfaceStack(stack, randomAction(random));
  return stack;
}

/** Runs one property across many seeds and names the failing seed. */
function forEachSeed(property: (random: () => number, seed: number) => void): void {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    try {
      property(makeRandom(seed), seed);
    } catch (error) {
      throw new Error(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** The ids on a stack whose Escape is not none, in order. */
function escapable(stack: SurfaceStack): SurfaceId[] {
  return stack.filter((id) => SURFACES[id].escape !== "none");
}

test("escape pops exactly one surface, the topmost that accepts Escape, and leaves the order", () => {
  forEachSeed((random) => {
    const stack = randomStack(random);
    const result = escape(stack);
    const candidates = escapable(stack);
    if (candidates.length === 0) {
      assert.equal(result.closed, "back");
      assert.equal(result.stack, stack);
      return;
    }
    assert.equal(result.closed, candidates.at(-1));
    assert.equal(result.stack.length, stack.length - 1);
    const position = stack.lastIndexOf(result.closed as SurfaceId);
    assert.deepEqual(result.stack, [...stack.slice(0, position), ...stack.slice(position + 1)]);
  });
});

test("back-step leaves the parent open with everything below it unchanged", () => {
  forEachSeed((random) => {
    const stack = randomStack(random);
    const stepped = backStep(stack);
    if (stack.length === 0) {
      assert.equal(stepped, stack);
      return;
    }
    assert.deepEqual(stepped, stack.slice(0, -1));
    if (stack.length > 1) assert.equal(stepped.at(-1), stack.at(-2));
  });
});

test("opening a surface twice is the same as opening it once", () => {
  forEachSeed((random) => {
    const stack = randomStack(random);
    const id = pick(random, SURFACE_IDS);
    const once = openSurface(stack, id);
    const twice = openSurface(once, id);
    assert.equal(twice, once);
    assert.equal(once.at(-1) === id || stack.includes(id), true);
  });
});

test("the stack never holds two modal surfaces on one layer and never holds an id twice", () => {
  forEachSeed((random) => {
    let stack = EMPTY_SURFACE_STACK;
    const steps = Math.floor(random() * MAX_ACTIONS);
    for (let step = 0; step < steps; step += 1) {
      stack = reduceSurfaceStack(stack, randomAction(random));
      assert.equal(new Set(stack).size, stack.length, `duplicate in ${stack.join(",")}`);
      const modalLayers = stack.filter(isModalSurface).map((id) => SURFACES[id].layer);
      assert.equal(new Set(modalLayers).size, modalLayers.length, `two modals on one layer in ${stack.join(",")}`);
    }
  });
});
