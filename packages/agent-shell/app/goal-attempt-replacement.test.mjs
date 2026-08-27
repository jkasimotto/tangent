import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  attemptReplacementIsSettled,
  newAttemptReplacement,
  readAllAttemptReplacements,
  readAttemptReplacement,
  sameAttemptReplacementRequest,
  transitionAttemptReplacement,
  unsettledAttemptReplacements,
  writeAttemptReplacement,
} from "./goal-attempt-replacement.mjs";

const launch = { harness: "claude", model: "fable-5", effort: "max" };

/** One current Goal queue and its exact owned source target. */
function fixture() {
  const goal = "otto/test/goal-ship.md";
  const sourceTarget = {
    instanceId: "shell-1", area: "otto/test", goal, assignmentId: "assignment-2", attemptId: "attempt-old",
    session: "ship-old", target: "$4", generation: 2,
  };
  const queue = {
    goal, area: "otto/test", revision: 7, currentAssignmentId: "assignment-2",
    steps: [{
      id: "assignment-2", status: "running", session: "ship-old",
      attempts: [{ id: "attempt-old", session: "ship-old", instanceId: "shell-1", endedAt: null }],
    }],
  };
  const input = { goal, assignmentId: "assignment-2", expectedRevision: 7, expectedAttemptId: "attempt-old", launch, operationId: "replace-1", sourceTarget };
  return { queue, input, sourceTarget };
}

test("replacement request requires current queue, attempt, and exact source target", () => {
  const { queue, input } = fixture();
  const operation = newAttemptReplacement(queue, input, "2026-08-27T08:00:00.000Z");
  assert.equal(operation.status, "requested");
  assert.equal(operation.sourceTarget.target, "$4");
  assert.equal(sameAttemptReplacementRequest(operation, input), true);
  assert.equal(sameAttemptReplacementRequest(operation, { ...input, launch: { ...launch, effort: "medium" } }), false);

  assert.throws(() => newAttemptReplacement(queue, { ...input, expectedRevision: 6 }), (error) => error.code === "stale-revision" && error.currentRevision === 7);
  assert.throws(() => newAttemptReplacement(queue, { ...input, expectedAttemptId: "older" }), (error) => error.code === "stale-attempt");
  assert.throws(() => newAttemptReplacement(queue, { ...input, sourceTarget: { ...input.sourceTarget, target: "" } }), (error) => error.code === "target-incomplete");
  assert.throws(() => newAttemptReplacement(queue, { ...input, sourceTarget: { ...input.sourceTarget, area: "otto/other" } }), (error) => error.code === "target-mismatch");
});

test("source retirement cannot begin before replacement prompt readiness", () => {
  const { queue, input } = fixture();
  const operation = newAttemptReplacement(queue, input, "2026-08-27T08:00:00.000Z");
  assert.throws(() => transitionAttemptReplacement(operation, "source-retiring"), (error) => error.code === "invalid-transition");
  transitionAttemptReplacement(operation, "replacement-starting", {
    replacementAttemptId: "attempt-new",
    replacementTarget: {
      instanceId: "shell-1", area: queue.area, goal: queue.goal, assignmentId: "assignment-2", attemptId: "attempt-new",
      session: "ship-new", target: "$9", generation: 3,
    },
    resolvedLaunch: { ref: launch, command: "claude --model fable-5 --effort max", label: "Claude · Fable 5 · Max" },
    startedAt: "2026-08-27T08:01:00.000Z",
  }, "2026-08-27T08:01:00.000Z");
  assert.throws(() => transitionAttemptReplacement(operation, "replacement-ready", { readiness: { kind: "process" } }), (error) => error.code === "replacement-not-ready");
  assert.equal(operation.status, "replacement-starting", "a refused transition does not edit durable state");

  transitionAttemptReplacement(operation, "replacement-ready", { readiness: { kind: "prompt-receipt", receiptId: "armed-9" } }, "2026-08-27T08:02:00.000Z");
  transitionAttemptReplacement(operation, "source-retiring", {}, "2026-08-27T08:03:00.000Z");
  transitionAttemptReplacement(operation, "complete", { sourceOutcome: { kind: "retired", detail: "exact target $4 ended" } }, "2026-08-27T08:04:00.000Z");
  assert.equal(operation.status, "complete");
  assert.equal(operation.readiness.kind, "prompt-receipt");
  assert.equal(operation.sourceOutcome.kind, "retired");
  assert.equal(attemptReplacementIsSettled(operation), true);
  assert.deepEqual(operation.events.map((event) => event.status), ["requested", "replacement-starting", "replacement-ready", "source-retiring", "complete"]);
});

test("startup failure and rollback preserve immutable source evidence", () => {
  const { queue, input, sourceTarget } = fixture();
  const failed = newAttemptReplacement(queue, input);
  transitionAttemptReplacement(failed, "failed", { error: "replacement launch failed" });
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.sourceTarget, sourceTarget);
  assert.equal(failed.replacementTarget, null);

  const rollback = newAttemptReplacement(queue, { ...input, operationId: "replace-2" });
  transitionAttemptReplacement(rollback, "replacement-starting", {
    replacementAttemptId: "attempt-new",
    replacementTarget: { ...sourceTarget, attemptId: "attempt-new", session: "ship-new", target: "$9", generation: 3 },
    resolvedLaunch: { ref: launch, command: "claude --model fable-5 --effort max" },
  });
  transitionAttemptReplacement(rollback, "rollback", { error: "prompt receipt timed out" });
  transitionAttemptReplacement(rollback, "failed", { error: "replacement target removed", replacementOutcome: { kind: "retired" } });
  assert.equal(rollback.status, "failed");
  assert.equal(rollback.sourceTarget.target, "$4");
  assert.equal(rollback.replacementTarget.target, "$9");
});

test("durable replacement operations round-trip and expose unsettled restart work", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "attempt-replacements-"));
  const { queue, input } = fixture();
  const pending = newAttemptReplacement(queue, input);
  const failed = newAttemptReplacement(queue, { ...input, operationId: "replace-failed" });
  transitionAttemptReplacement(failed, "failed", { error: "no harness" });
  await writeAttemptReplacement(root, pending);
  await writeAttemptReplacement(root, failed);
  assert.equal((await readdir(root)).length, 2);
  assert.deepEqual(await readAttemptReplacement(root, queue.goal, pending.id), pending);
  const all = await readAllAttemptReplacements(root);
  assert.deepEqual(unsettledAttemptReplacements(all).map((operation) => operation.id), ["replace-1"]);
});
