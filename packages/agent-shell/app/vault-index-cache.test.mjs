// The vault index cache keeps Document reads under a second by building the
// index once per vault change (goal-opening-and-saving-a-document-takes-under-a-seco).
import assert from "node:assert/strict";
import test from "node:test";
import { createFingerprintCache } from "./vault-index-cache.mjs";

test("an unchanged fingerprint answers from memory and a changed one rebuilds", async () => {
  let key = "a";
  let builds = 0;
  const cached = createFingerprintCache({
    /** Returns the mutable test fingerprint. */
    fingerprint: async () => key,
    /** Counts and returns each cache build. */
    build: async () => ({ built: ++builds }),
  });
  const first = await cached();
  assert.deepEqual(first, { built: 1 });
  assert.equal(await cached(), first, "the same fingerprint returns the same object");
  assert.equal(await cached(), first);
  assert.equal(builds, 1, "an unchanged vault is never rebuilt");
  key = "b";
  assert.deepEqual(await cached(), { built: 2 }, "a changed vault is rebuilt at once");
  assert.equal(builds, 2);
  key = "a";
  assert.deepEqual(await cached(), { built: 3 }, "only the last build is kept");
});

test("a burst of requests during one build costs one build", async () => {
  let builds = 0;
  let release;
  const started = new Promise((resolve) => { release = resolve; });
  const cached = createFingerprintCache({
    /** Returns the stable test fingerprint. */
    fingerprint: async () => "same",
    /** Waits until the test releases the shared build. */
    build: async () => {
      builds += 1;
      await started;
      return { builds };
    },
  });
  const waiting = [cached(), cached(), cached(), cached()];
  release();
  const results = await Promise.all(waiting);
  assert.equal(builds, 1, "concurrent callers share the build in flight");
  for (const result of results) assert.equal(result, results[0]);
});

test("a failed build is not cached and does not poison the next request", async () => {
  let attempt = 0;
  const cached = createFingerprintCache({
    /** Returns the stable test fingerprint. */
    fingerprint: async () => "same",
    /** Fails once and succeeds on the retry. */
    build: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("vault unreadable");
      return { attempt };
    },
  });
  await assert.rejects(cached(), /vault unreadable/);
  assert.deepEqual(await cached(), { attempt: 2 });
});
