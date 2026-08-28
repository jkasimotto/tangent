import assert from "node:assert/strict";
import test from "node:test";
import { beginRecoveryStep, expireRecoverySteps, finishRecoveryStep, nextRecoveryAction } from "./recovery-ladder.mjs";

test("one nudge is durable across controller restarts", () => {
  const attempt = { recovery: [] };
  const input = { record: attempt, goal: "g", assignment: "a", attempt: "try", kind: "nudge", instanceId: "one", target: "$1", now: 0 };
  assert.equal(beginRecoveryStep(input).repeated, false);
  assert.equal(beginRecoveryStep({ ...input, instanceId: "two" }).repeated, true);
  assert.equal(attempt.recovery.length, 1);
});

test("a lease expires and the next controller can continue", () => {
  const attempt = { recovery: [] };
  const { step } = beginRecoveryStep({ record: attempt, goal: "g", assignment: "a", attempt: "try", kind: "resume-in-place", instanceId: "one", target: "$1", now: 0, leaseMs: 10 });
  assert.equal(expireRecoverySteps(attempt, 11), true);
  assert.equal(step.result, "expired");
});

test("the ladder selects one action and records a terminal result", () => {
  const assignment = { status: "running", startedAt: new Date(0).toISOString(), attempts: [{ id: "try", startedAt: new Date(0).toISOString(), recovery: [] }] };
  assert.equal(nextRecoveryAction({ assignment, observation: { process: "shell" }, now: 200_000 }).kind, "resume-in-place");
  const { step } = beginRecoveryStep({ record: assignment.attempts[0], goal: "g", assignment: "a", attempt: "try", kind: "resume-in-place", instanceId: "one", target: "$1", now: 0 });
  assert.equal(finishRecoveryStep(assignment.attempts[0], step.operationId, "failed", { terminal: true }), true);
  assert.equal(step.terminal, true);
});
