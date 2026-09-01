import assert from "node:assert/strict";
import test from "node:test";
import { createWorkMutationOperations } from "./public/work-mutation-operations.js";

test("pending Work mutations suppress duplicates without changing Work facts", () => {
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
  assert.equal(dismiss.operation.operationId.length > 10, true);
  assert.equal(records.some((record) => record[1] === "duplicate-suppressed"), true);
  store.committed(park, { state: "committed" });
  store.committed(stop, { state: "committed" });
  store.committed(dismiss.operation, { state: "committed" });
  assert.equal(store.operations.size, 0);
});

test("rollback and command acknowledgement clear progress only", () => {
  const store = createWorkMutationOperations({
    /** Returns a fixed monotonic test time. */
    now: () => 10,
    schedule: null,
  });
  const rejected = store.begin("park", "otto/tangent/goal-one.md").operation;
  assert.equal(store.rollback(rejected, new Error("Git refused")), true);
  const dismissed = store.begin("dismiss", "otto/tangent\0design.md").operation;
  store.committed(dismissed, { state: "committed" });
  assert.equal(store.operations.size, 0);
});
