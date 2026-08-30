import assert from "node:assert/strict";
import test from "node:test";
import { newAttemptReplacement, transitionAttemptReplacement } from "./goal-attempt-replacement.mjs";
import {
  GoalExecutionTransitionError,
  attachLateSourceEvidence,
  parkCurrentGoalAttempt,
  promoteReadyReplacement,
  reopenParkedGoalQueue,
} from "./goal-execution-transition.mjs";
import { newPipeline } from "./pipeline-record.mjs";

const oldLaunch = { harness: "claude", model: "sonnet-5", effort: "medium" };
const newLaunch = { harness: "codex-otto", model: "sol", effort: "high" };
const newCommand = "codex --approve-for-me --model sol --effort high";

/** One live assignment followed by an untouched pending suffix. */
function queueFixture() {
  const queue = newPipeline({
    goal: "otto/test/goal-ship.md",
    area: "otto/test",
    slug: "ship",
    extraFiles: ["otto/test/goal-companion.md"],
    steps: [
      { id: "current", instruction: "Ship the change.", kind: "implementation", path: "/repo", launch: oldLaunch },
      { id: "review", instruction: "Review the change.", kind: "review", launch: oldLaunch, continueFromAssignmentId: "current" },
      { id: "release", instruction: "Release it.", command: "codex", continueFromAssignmentId: "review" },
    ],
    now: "2026-08-27T08:00:00.000Z",
  });
  const assignment = queue.steps[0];
  assignment.status = "running";
  assignment.session = "ship-old";
  assignment.startedAt = "2026-08-27T08:01:00.000Z";
  assignment.attempts = [{
    id: "attempt-old", kind: "managed", session: "ship-old", instanceId: "shell-1", startedAt: assignment.startedAt,
    endedAt: null, report: null, result: null, resolvedLaunch: { ref: oldLaunch, command: "claude --model sonnet-5" },
  }];
  queue.currentAssignmentId = assignment.id;
  queue.revision = 7;
  queue.instanceId = "shell-1";
  return queue;
}

test("Park ends only the exact current attempt and preserves the queue", () => {
  const queue = queueFixture();
  const pendingBefore = structuredClone(queue.steps.slice(1));
  const result = parkCurrentGoalAttempt(queue, {
    assignmentId: "current",
    expectedAttemptId: "attempt-old",
    expectedRevision: 7,
    operationId: "park-1",
    reason: " Wait for the release window.\nKeep this work. ",
    now: "2026-08-27T09:00:00.000Z",
  });
  assert.equal(result.state, "parked");
  assert.equal(result.sourceSession, "ship-old");
  assert.equal(queue.status, "parked");
  assert.equal(queue.currentAssignmentId, null);
  assert.equal(queue.steps[0].status, "stopped");
  assert.equal(queue.steps[0].session, null);
  assert.equal(queue.steps[0].attempts.length, 1);
  assert.deepEqual(queue.steps[0].attempts[0].disposition, {
    type: "parked", reason: "Wait for the release window. Keep this work.", at: "2026-08-27T09:00:00.000Z",
  });
  assert.deepEqual(queue.steps.slice(1), pendingBefore);
  assert.deepEqual(queue.extraFiles, ["otto/test/goal-companion.md"]);

  const repeated = parkCurrentGoalAttempt(queue, {
    assignmentId: "current", expectedAttemptId: "attempt-old", expectedRevision: 7, operationId: "park-1",
  });
  assert.equal(repeated.state, "repeated");
  assert.equal(queue.revision, 8);
});

test("a stale Park refusal is atomic", () => {
  const queue = queueFixture();
  const before = structuredClone(queue);
  assert.throws(() => parkCurrentGoalAttempt(queue, {
    assignmentId: "current", expectedAttemptId: "attempt-other", expectedRevision: 7, operationId: "park-bad",
  }), (error) => error instanceof GoalExecutionTransitionError && error.code === "stale-attempt");
  assert.deepEqual(queue, before);
});

test("Reopen changes only the parked queue lifecycle and starts nothing", () => {
  const queue = queueFixture();
  parkCurrentGoalAttempt(queue, {
    assignmentId: "current", expectedAttemptId: "attempt-old", expectedRevision: 7, operationId: "park-1",
  });
  const attemptsBefore = structuredClone(queue.steps.map((assignment) => assignment.attempts));
  const result = reopenParkedGoalQueue(queue, { expectedRevision: 8, operationId: "reopen-1", now: "2026-08-27T10:00:00.000Z" });
  assert.equal(result.state, "reopened");
  assert.equal(queue.status, "open");
  assert.equal(queue.currentAssignmentId, null);
  assert.equal(queue.steps[0].status, "stopped");
  assert.equal(queue.steps[0].session, null);
  assert.deepEqual(queue.steps.map((assignment) => assignment.attempts), attemptsBefore);
  assert.equal(queue.parks[0].reopenedAt, "2026-08-27T10:00:00.000Z");
});

test("a ready replacement atomically becomes current without rewriting assignment or later steps", () => {
  const queue = queueFixture();
  const sourceTarget = {
    instanceId: "shell-1", area: queue.area, goal: queue.goal, assignmentId: "current", attemptId: "attempt-old",
    session: "ship-old", target: "$4", generation: 1,
  };
  const operation = newAttemptReplacement(queue, {
    goal: queue.goal, assignmentId: "current", expectedRevision: 7, expectedAttemptId: "attempt-old",
    launch: newLaunch, operationId: "replace-1", sourceTarget,
  }, "2026-08-27T09:00:00.000Z");
  transitionAttemptReplacement(operation, "replacement-starting", {
    replacementAttemptId: "attempt-new",
    replacementTarget: { ...sourceTarget, attemptId: "attempt-new", session: "ship-new", target: "$9", generation: 2 },
    resolvedLaunch: { ref: newLaunch, command: newCommand, label: "Codex · Otto · Sol · High" },
    startedAt: "2026-08-27T09:01:00.000Z",
  }, "2026-08-27T09:01:00.000Z");
  transitionAttemptReplacement(operation, "replacement-ready", {
    readiness: { kind: "prompt-receipt", receiptId: "prompt-9" },
  }, "2026-08-27T09:02:00.000Z");
  const stableFields = {
    instruction: queue.steps[0].instruction,
    kind: queue.steps[0].kind,
    path: queue.steps[0].path,
    continueFromAssignmentId: queue.steps[0].continueFromAssignmentId,
    reports: structuredClone(queue.steps[0].reports),
  };
  const laterBefore = structuredClone(queue.steps.slice(1));

  const result = promoteReadyReplacement(queue, operation, "2026-08-27T09:03:00.000Z");
  assert.equal(result.state, "replacement-promoted");
  assert.equal(queue.currentAssignmentId, "current");
  assert.equal(queue.steps[0].session, "ship-new");
  assert.equal(queue.steps[0].status, "running");
  assert.deepEqual({
    instruction: queue.steps[0].instruction,
    kind: queue.steps[0].kind,
    path: queue.steps[0].path,
    continueFromAssignmentId: queue.steps[0].continueFromAssignmentId,
    reports: queue.steps[0].reports,
  }, stableFields);
  assert.deepEqual(queue.steps.slice(1), laterBefore);
  assert.equal(queue.steps[0].attempts.length, 2);
  assert.equal(queue.steps[0].attempts[0].endedAt, "2026-08-27T09:03:00.000Z");
  assert.equal(queue.steps[0].attempts[0].replacedByAttemptId, "attempt-new");
  assert.deepEqual(queue.steps[0].attempts[1].resolvedLaunch, operation.resolvedLaunch);
  assert.deepEqual(queue.steps[0].attempts[1].target, operation.replacementTarget);
  assert.equal(queue.steps[0].attempts[1].endedAt, null);

  const repeated = promoteReadyReplacement(queue, operation);
  assert.equal(repeated.state, "repeated");
  assert.equal(queue.steps[0].attempts.length, 2);
});

test("late source evidence stays on replaced history and cannot advance the current attempt", () => {
  const queue = queueFixture();
  const sourceTarget = {
    instanceId: "shell-1", area: queue.area, goal: queue.goal, assignmentId: "current", attemptId: "attempt-old",
    session: "ship-old", target: "$4", generation: 1,
  };
  const operation = newAttemptReplacement(queue, {
    goal: queue.goal, assignmentId: "current", expectedRevision: 7, expectedAttemptId: "attempt-old",
    launch: newLaunch, operationId: "replace-1", sourceTarget,
  });
  transitionAttemptReplacement(operation, "replacement-starting", {
    replacementAttemptId: "attempt-new",
    replacementTarget: { ...sourceTarget, attemptId: "attempt-new", session: "ship-new", target: "$9" },
    resolvedLaunch: { ref: newLaunch, command: newCommand },
  });
  transitionAttemptReplacement(operation, "replacement-ready", { readiness: { kind: "julian-confirmed" } });
  promoteReadyReplacement(queue, operation);
  const currentBefore = structuredClone(queue.steps[0].attempts[1]);
  const reportsBefore = structuredClone(queue.steps[0].reports);
  const revisionBefore = queue.revision;
  const result = attachLateSourceEvidence(queue, {
    assignmentId: "current",
    attemptId: "attempt-old",
    idempotencyKey: "late-1",
    evidence: { type: "implementation-result", status: "complete", summary: "The old worker finished after replacement." },
    now: "2026-08-27T11:00:00.000Z",
  });
  assert.equal(result.state, "late-evidence-attached");
  assert.equal(queue.revision, revisionBefore + 1);
  assert.equal(queue.currentAssignmentId, "current");
  assert.equal(queue.steps[0].session, "ship-new");
  assert.equal(queue.steps[0].status, "running");
  assert.deepEqual(queue.steps[0].reports, reportsBefore);
  assert.deepEqual(queue.steps[0].attempts[1], currentBefore);
  assert.equal(queue.steps[0].attempts[0].lateEvidence[0].summary, "The old worker finished after replacement.");

  const repeated = attachLateSourceEvidence(queue, {
    assignmentId: "current", attemptId: "attempt-old", idempotencyKey: "late-1", evidence: { summary: "different retry" },
  });
  assert.equal(repeated.state, "repeated");
  assert.equal(queue.steps[0].attempts[0].lateEvidence.length, 1);
  assert.throws(() => attachLateSourceEvidence(queue, {
    assignmentId: "current", attemptId: "attempt-new", idempotencyKey: "late-current", evidence: { summary: "wrong target" },
  }), (error) => error.code === "attempt-not-replaced");
});
