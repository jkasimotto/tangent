import assert from "node:assert/strict";
import test from "node:test";
import { createRefreshCoordinator, startRebuildRefresh, startRefreshLifecycle } from "./public/refresh-lifecycle.js";

test("event reconnects and the 30-second recovery poll each request one conditional Work read", () => {
  const listeners = new Map();
  const triggers = [];
  let interval;
  let delay;
  class Events {
    /** Saves one event listener. */
    addEventListener(name, callback) { listeners.set(name, callback); }
    /** Closes the fixture event stream. */
    close() {}
  }
  const lifecycle = startRefreshLifecycle((options) => { triggers.push(options.trigger); }, {
    EventSource: Events,
    /** Saves the recovery interval. */
    setInterval(callback, milliseconds) { interval = callback; delay = milliseconds; return 1; },
    /** Clears the fixture recovery interval. */
    clearInterval() {},
  });
  listeners.get("open")();
  listeners.get("changed")();
  interval();
  assert.equal(delay, 30_000);
  assert.deepEqual(triggers, ["event-open", "event", "timer"]);
  lifecycle.stop();
});

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

test("refresh coordinator serializes triggers and runs one trailing refresh", async () => {
  let release;
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const coordinator = createRefreshCoordinator(async () => {
    calls += 1;
    active += 1;
    maximum = Math.max(maximum, active);
    if (calls === 1) await new Promise((resolve) => { release = resolve; });
    active -= 1;
  });

  const first = coordinator.request({ trigger: "event" });
  await Promise.resolve();
  const second = coordinator.request({ trigger: "timer" });
  const third = coordinator.request({ trigger: "mutation" });
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second, third]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  assert.equal(maximum, 1);
  coordinator.stop();
});

test("refresh coordinator owns one delayed retry", async () => {
  const timers = [];
  let calls = 0;
  const environment = {
    /** Captures one retry timer. */
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    /** Accepts retry timer cancellation. */
    clearTimeout() {},
  };
  const coordinator = createRefreshCoordinator(async () => {
    calls += 1;
    return calls === 1 ? { retryAfterMs: 750 } : null;
  }, environment);
  await coordinator.request({ trigger: "event" });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 750);
  timers[0].callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);
  coordinator.stop();
});

test("triggers received during Retry-After join the scheduled retry", async () => {
  const timers = [];
  const options = [];
  let cancellations = 0;
  const environment = {
    /** Captures the one retry timer. */
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    /** Records an invalid attempt to bypass Retry-After. */
    clearTimeout() { cancellations += 1; },
  };
  const coordinator = createRefreshCoordinator(async (requestOptions) => {
    options.push(requestOptions);
    return options.length === 1 ? { retryAfterMs: 1_000 } : null;
  }, environment);
  await coordinator.request({ trigger: "event" });
  const joined = coordinator.request({ trigger: "mutation", initial: true });
  await Promise.resolve();
  assert.equal(options.length, 1, "a new trigger must not start before Retry-After");
  assert.equal(cancellations, 0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1_000);
  timers[0].callback();
  await joined;
  assert.equal(options.length, 2);
  assert.deepEqual(options[1], { trigger: "mutation", initial: true });
  coordinator.stop();
});

test("a pending trigger respects backpressure before its trailing refresh", async () => {
  const timers = [];
  let release;
  let calls = 0;
  const environment = {
    /** Captures one backpressure timer. */
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    /** Accepts backpressure timer cancellation. */
    clearTimeout() {},
  };
  const coordinator = createRefreshCoordinator(async () => {
    calls += 1;
    if (calls === 1) await new Promise((resolve) => { release = resolve; });
    return calls === 1 ? { retryAfterMs: 1_000 } : null;
  }, environment);
  const first = coordinator.request({ trigger: "event" });
  await Promise.resolve();
  coordinator.request({ trigger: "timer" });
  release();
  await first;
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(timers[0].delay, 1_000);
  timers[0].callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);
  coordinator.stop();
});
