import assert from "node:assert/strict";
import test from "node:test";
import { createWorkPublisher } from "./work-publisher.mjs";
import { WORK_SCHEMA } from "./work-model.mjs";

/** Creates one valid empty candidate. */
function candidate(version = "one") {
  const source = { version, condition: "current" };
  return { schema: WORK_SCHEMA, fence: { areas: source, goals: source, jobs: source, agents: source, brains: source, processes: source, presentations: source }, areas: [], goals: [], agents: [], brains: [], processes: [], problems: [] };
}

test("one candidate remains in flight and a later dirty sequence survives its acknowledgement", async () => {
  let release;
  let calls = 0;
  const publisher = createWorkPublisher({
    adapters: {
      /** Returns a new source generation. */
      async reconcile() { calls += 1; return candidate(String(calls)); },
    },
    controllerBoot: "controller",
    /** Holds each candidate until the test acknowledges it. */
    sendCandidate: (message) => new Promise((resolve) => { release = () => resolve({ ok: true, changed: true, sourceWatermark: message.sourceWatermark }); }),
    intervalMs: 60_000,
  });
  publisher.invalidate("goals", "first");
  const first = publisher.publish();
  await new Promise((resolve) => setImmediate(resolve));
  publisher.invalidate("goals", "second");
  assert.equal(publisher.status().inFlight, true);
  release();
  await first;
  assert.equal(publisher.status().dirty, 1);
  const second = publisher.publish();
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await second;
  assert.equal(calls, 2);
  assert.equal(publisher.status().dirty, 0);
  publisher.stop();
});

test("a rejected semantic candidate is suppressed until a newer transition", async () => {
  let sends = 0;
  const publisher = createWorkPublisher({ adapters: {
    /** Returns the same rejected semantic candidate. */
    reconcile: async () => candidate(),
  }, controllerBoot: "controller",
  /** Rejects every candidate. */
  sendCandidate: async () => { sends += 1; return { ok: false, code: "candidate-invalid" }; } });
  publisher.invalidate("goals", "one");
  await publisher.publish();
  await publisher.publish();
  assert.equal(sends, 1);
  publisher.invalidate("goals", "two");
  await publisher.publish();
  assert.equal(sends, 2);
  publisher.stop();
});
