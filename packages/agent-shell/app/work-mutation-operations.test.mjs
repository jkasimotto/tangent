import assert from "node:assert/strict";
import test from "node:test";
import { createWorkMutationOperations } from "./public/work-mutation-operations.js";

/** Returns one representative Work projection. */
function fixture() {
  return {
    vault: { areas: [{ path: "otto/tangent", presentations: [{ file: "design.md" }], goals: [{ file: "otto/tangent/goal-one.md", status: "active", presentations: [{ file: "goal-design.md" }] }] }] },
    sessions: [{ name: "one", target: "$17" }],
  };
}

test("pending Work mutations suppress duplicates and stale projection rows", () => {
  const records = [];
  const store = createWorkMutationOperations({
    /** Returns a fixed monotonic test time. */
    now: () => 10,
    /** Captures mutation telemetry for assertions. */
    record: (...args) => records.push(args),
    schedule: null,
  });
  const dismiss = store.begin("dismiss", "otto/tangent/goal-one.md\0goal-design.md");
  assert.equal(store.begin("dismiss", "otto/tangent/goal-one.md\0goal-design.md").repeated, true);
  const park = store.begin("park", "otto/tangent/goal-one.md").operation;
  const stop = store.begin("stop", "one\0$17").operation;
  const projection = fixture();
  store.merge(projection.vault, projection.sessions);
  assert.equal(projection.vault.areas[0].goals.length, 0);
  assert.equal(projection.sessions[0].pendingStop, true);
  assert.equal(dismiss.operation.operationId.length > 10, true);
  assert.equal(records.some((record) => record[1] === "duplicate-suppressed"), true);
  store.committed(park, { state: "committed" });
  store.committed(stop, { state: "committed" });
});

test("rollback restores authority to the saved projection and convergence clears an overlay", () => {
  const store = createWorkMutationOperations({
    /** Returns a fixed monotonic test time. */
    now: () => 10,
    schedule: null,
  });
  const rejected = store.begin("park", "otto/tangent/goal-one.md").operation;
  assert.equal(store.rollback(rejected, new Error("Git refused")), true);
  const projection = fixture();
  store.merge(projection.vault, projection.sessions);
  assert.equal(projection.vault.areas[0].goals.length, 1);

  const dismissed = store.begin("dismiss", "otto/tangent\0design.md").operation;
  store.committed(dismissed, { state: "committed" });
  const converged = fixture();
  converged.vault.areas[0].presentations = [];
  store.merge(converged.vault, converged.sessions);
  assert.equal(store.operations.size, 0);
});
