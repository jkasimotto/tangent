import assert from "node:assert/strict";
import test from "node:test";
import { pipelineExecution, soloExecution } from "./execution-record.mjs";

test("pipeline and solo records expose the same continuation contract", async () => {
  const pipeline = { area: "otto", steps: [{ session: "step-old" }] };
  const solo = { area: "otto", session: "goal-old", continuations: [] };
  const saved = [];
  /** Records a save. */
  const saveRecord = async (record) => saved.push(record);
  const executions = [
    pipelineExecution({ record: pipeline, step: pipeline.steps[0], save: saveRecord }),
    soloExecution({ record: solo, area: "otto", save: saveRecord }),
  ];

  for (const execution of executions) {
    const original = execution.unit.session;
    const entry = { session: original, next: `${original}-next`, facts: "facts" };
    await execution.continueTo(entry);
    assert.equal(execution.unit.session, entry.next);
    assert.deepEqual(execution.unit.continuations, [entry]);
    await execution.failContinuation(entry);
    assert.equal(execution.unit.session, original);
    assert.equal(entry.failed, true);
  }
  assert.equal(saved.length, 4);
});
