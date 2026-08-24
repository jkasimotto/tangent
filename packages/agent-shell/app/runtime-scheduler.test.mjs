import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeScheduler } from "./runtime-scheduler.mjs";

test("scheduler runs independent task lanes concurrently", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let fastRan = false;
  const scheduler = createRuntimeScheduler([
    {
      name: "slow projection",
      intervalMs: 0,
      /** Keeps the fixture lane active. */
      active: () => true,
      /** Holds the slow fixture lane at its gate. */
      run: async () => gate,
    },
    {
      name: "message delivery",
      intervalMs: 0,
      /** Keeps the fixture lane active. */
      active: () => true,
      /** Records independent fixture progress. */
      run: async () => { fastRan = true; },
    },
  ]);
  const tick = scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fastRan, true);
  release();
  await tick;
});

test("scheduler never overlaps one named task lane", async () => {
  let active = 0;
  let peak = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const scheduler = createRuntimeScheduler([{
    name: "lane", intervalMs: 0,
    /** Keeps the fixture lane active. */
    active: () => true,
    /** Records fixture overlap while held at a gate. */
    async run() { active += 1; peak = Math.max(peak, active); await gate; active -= 1; },
  }]);
  const first = scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  await scheduler.tick();
  release();
  await first;
  assert.equal(peak, 1);
});
