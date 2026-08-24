import assert from "node:assert/strict";
import test from "node:test";
import { createVaultProjectionController } from "./vault-projection-controller.mjs";

test("a changed vault serves the last projection while one refresh runs", async () => {
  let key = "one";
  let release;
  const second = new Promise((resolve) => { release = resolve; });
  let builds = 0;
  const controller = createVaultProjectionController({
    /** Returns the current test vault identity. */
    fingerprint: async () => key,
    /** Holds the second projection until this test releases it. */
    build: async () => (++builds === 1 ? { areas: ["one"] } : second),
  });
  assert.deepEqual(await controller.get(), { areas: ["one"] });
  key = "two";
  assert.deepEqual(await controller.get(), { areas: ["one"] });
  assert.equal((await controller.status()).building, true);
  release({ areas: ["two"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await controller.get(), { areas: ["two"] });
  assert.equal(builds, 2);
});

test("a failed refresh preserves the last successful projection and reports stale", async () => {
  let key = "one";
  let fail = false;
  const controller = createVaultProjectionController({
    /** Returns the current test vault identity. */
    fingerprint: async () => key,
    /** Simulates a projection failure after one successful build. */
    build: async () => {
      if (fail) throw new Error("bad markdown");
      return { areas: ["one"] };
    },
  });
  await controller.get();
  key = "two";
  fail = true;
  assert.deepEqual(await controller.get(), { areas: ["one"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await controller.get(), { areas: ["one"] });
  const status = await controller.status();
  assert.equal(status.stale, true);
  assert.equal(status.error, "bad markdown");
});

test("an initial build is aborted at its deadline", async () => {
  const controller = createVaultProjectionController({
    /** Returns one stable test vault identity. */
    fingerprint: async () => "one",
    timeoutMs: 5,
    /** Waits until the controller cancels this pathological build. */
    build: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  });
  await assert.rejects(controller.get(), /exceeded 5 ms/);
  assert.equal((await controller.status()).error, "Vault projection exceeded 5 ms.");
});

test("an explicit mutation invalidation makes the next reader wait for a coherent projection", async () => {
  let value = "before";
  const controller = createVaultProjectionController({
    /** Returns the mutable fixture identity. */
    fingerprint: async () => value,
    /** Returns the projection for the current fixture identity. */
    build: async () => ({ value }),
  });
  assert.deepEqual(await controller.get(), { value: "before" });
  value = "after";
  controller.invalidate();
  assert.deepEqual(await controller.get(), { value: "after" });
  assert.equal((await controller.status()).invalidated, false);
});
