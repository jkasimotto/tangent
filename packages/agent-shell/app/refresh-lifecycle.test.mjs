import assert from "node:assert/strict";
import test from "node:test";
import { startRebuildRefresh } from "./public/refresh-lifecycle.js";

test("active rebuilds use a dedicated 750 ms refresh", () => {
  let callback;
  let delay;
  let refreshes = 0;
  let active = false;
  const environment = {
    /** Captures the browser timer. */
    setInterval(fn, ms) { callback = fn; delay = ms; return 7; },
    /** Makes sure that the lifecycle clears its own timer. */
    clearInterval(id) { assert.equal(id, 7); },
  };
  const lifecycle = startRebuildRefresh(() => active, () => { refreshes += 1; }, environment);
  assert.equal(delay, 750);
  callback();
  assert.equal(refreshes, 0);
  active = true;
  callback();
  assert.equal(refreshes, 1);
  lifecycle.stop();
});
