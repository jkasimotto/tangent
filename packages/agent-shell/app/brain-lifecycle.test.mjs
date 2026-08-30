import assert from "node:assert/strict";
import test from "node:test";
import { refreshBrainObservation } from "./brain-lifecycle.mjs";

test("a live attempt created after the snapshot is fresh current evidence", async () => {
  const result = await refreshBrainObservation({
    session: "tangent-brain-g2",
    observed: null,
    instanceId: "shell-one",
    /** Test helper for inspect. */
    inspect: async () => ({ state: "live", instanceId: "shell-one", target: "$2" }),
  });
  assert.deepEqual(result, {
    observed: { name: "tangent-brain-g2", owned: true },
    live: true,
    canJudgeAbsence: true,
    state: "fresh",
  });
});

test("only a proved absence lets reconciliation recover a missing attempt", async () => {
  const absent = await refreshBrainObservation({
    session: "tangent-brain-g2", instanceId: "shell-one",
    /** Test helper for inspect. */
    inspect: async () => ({ state: "absent", instanceId: null }),
  });
  assert.equal(absent.canJudgeAbsence, true);
  assert.equal(absent.live, false);

  for (const current of [
    { state: "live", instanceId: "shell-two", target: "$2" },
    { state: "live", instanceId: null, target: "$2" },
    { state: "error", instanceId: null, error: new Error("tmux timed out") },
  ]) {
    const refused = await refreshBrainObservation({
      session: "tangent-brain-g2", instanceId: "shell-one",
        /** Test helper for inspect. */
        inspect: async () => current,
    });
    assert.equal(refused.canJudgeAbsence, false);
    assert.equal(refused.live, false);
  }
});

test("a captured live snapshot remains safe evidence while the lock waits", async () => {
  let inspected = false;
  const observed = { name: "tangent-brain-g1", owned: true };
  const result = await refreshBrainObservation({
    session: observed.name,
    observed,
    instanceId: "shell-one",
    /** Test helper for inspect. */
    inspect: async () => { inspected = true; return { state: "absent" }; },
  });
  assert.equal(inspected, false, "a live snapshot can delay recovery but never causes a false recovery");
  assert.equal(result.live, true);
  assert.equal(result.observed, observed);
});

test("a replacement target or stale generation cannot satisfy the current attempt", async () => {
  const base = { name: "hedno-brain", owned: true, target: "$replacement", brain: "otto/hedno", area: "otto/hedno", generation: 2 };
  const replaced = await refreshBrainObservation({ session: base.name, observed: base, instanceId: "shell-one", expectedTarget: "$1854", expectedArea: "otto/hedno", expectedGeneration: 2,
    /** Supplies an unused fallback because the snapshot has the session. */
    inspect: async () => ({ state: "absent" }),
  });
  assert.equal(replaced.live, false);
  assert.equal(replaced.state, "mismatch");
  const stale = await refreshBrainObservation({ session: base.name, observed: { ...base, target: "$1854", generation: 1 }, instanceId: "shell-one", expectedTarget: "$1854", expectedArea: "otto/hedno", expectedGeneration: 2,
    /** Supplies an unused fallback because the snapshot has the session. */
    inspect: async () => ({ state: "absent" }),
  });
  assert.equal(stale.live, false);
});
