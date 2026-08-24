import assert from "node:assert/strict";
import test from "node:test";
import { createObservationCache } from "./observation-cache.mjs";

test("observation cache coalesces concurrent refreshes", async () => {
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createObservationCache({
    /** Waits until every caller has joined the same fixture refresh. */
    async load() { loads += 1; await gate; return ["session"]; },
  });
  const readers = Array.from({ length: 100 }, () => cache.get());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  release();
  assert.ok((await Promise.all(readers)).every((value) => value[0] === "session"));
});

test("observation cache keeps its last valid snapshot after a refresh failure", async () => {
  let at = 1_000;
  let fail = false;
  const reports = [];
  const cache = createObservationCache({
    /** Returns one fixture snapshot, then simulates a timed-out tmux refresh. */
    async load() { if (fail) throw new Error("tmux timed out"); return ["live"]; },
    ttlMs: 10,
    /** Returns the mutable fixture clock. */
    now: () => at,
    /** Records the expected refresh failure. */
    report: (...parts) => reports.push(parts.join(" ")),
  });
  assert.deepEqual(await cache.get(), ["live"]);
  at += 20;
  fail = true;
  assert.deepEqual(await cache.get(), ["live"]);
  assert.equal(cache.status().stale, true);
  assert.match(reports[0], /tmux timed out/);
});

test("observation cache backs off repeated failed refreshes", async () => {
  let at = 0;
  let loads = 0;
  let fail = false;
  const cache = createObservationCache({
    /** Counts fixture loads and optionally fails them. */
    load: async () => { loads += 1; if (fail) throw new Error("down"); return ["live"]; },
    ttlMs: 1,
    retryMs: 100,
    /** Returns the mutable fixture clock. */
    now: () => at,
    /** Accepts the expected refresh failure. */
    report() {},
  });
  await cache.get();
  fail = true;
  at = 2;
  await cache.get();
  at = 50;
  await cache.get();
  assert.equal(loads, 2);
  at = 103;
  await cache.get();
  assert.equal(loads, 3);
});

test("invalidation during a refresh cannot make its older result fresh", async () => {
  const releases = [];
  let loads = 0;
  const cache = createObservationCache({
    ttlMs: 1_000,
    /** Holds each generation until the test releases it. */
    load: async () => {
      loads += 1;
      const current = loads;
      await new Promise((resolve) => releases.push(resolve));
      return [`generation-${current}`];
    },
  });

  const beforeMutation = cache.get();
  await new Promise((resolve) => setImmediate(resolve));
  cache.invalidate();
  const afterMutation = cache.get();
  releases.shift()();
  assert.deepEqual(await beforeMutation, ["generation-1"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 2);
  releases.shift()();
  assert.deepEqual(await afterMutation, ["generation-2"]);
  assert.equal(cache.status().stale, false);
});
