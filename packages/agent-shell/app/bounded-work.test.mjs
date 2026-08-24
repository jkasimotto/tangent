import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "./bounded-work.mjs";

test("bounded map preserves order and limits concurrent work", async () => {
  let active = 0;
  let peak = 0;
  const output = await mapWithConcurrency(Array.from({ length: 200 }, (_, index) => index), 8, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 8);
  assert.deepEqual(output, Array.from({ length: 200 }, (_, index) => index * 2));
});

test("bounded map handles empty input without calling the mapper", async () => {
  let called = false;
  assert.deepEqual(await mapWithConcurrency([], 8, async () => { called = true; }), []);
  assert.equal(called, false);
});
