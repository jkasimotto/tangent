import assert from "node:assert/strict";
import test from "node:test";
import { goalIsHiddenByDefault, goalIsTerminal, goalIsUnresolved, goalStatusChange, normalizeGoalRecord, normalizeGoalStatus, parkingNeedsConfirmation, goalIsFlaggedForVerify, goalWaitsForCheck, SETTLED_GOAL_STATUSES } from "./goal-lifecycle.mjs";

test("legacy Deferred reads as Parked but writers reject the retired value", () => {
  assert.equal(normalizeGoalStatus("deferred"), "parked");
  assert.equal(normalizeGoalStatus("parked"), "parked");
  assert.equal(normalizeGoalStatus(), "open");
  assert.throws(() => goalStatusChange("open", "deferred"), (error) => error.code === "status-retired");
});

test("Goal normalization includes relationship status projections", () => {
  const goal = normalizeGoalRecord({
    file: "otto/test/goal-main.md",
    status: "deferred",
    dependsOn: [{ file: "done.md", status: "done" }, { file: "parked.md", status: "deferred" }],
    requiredBy: [{ file: "next.md", status: "open" }],
  });
  assert.equal(goal.status, "parked");
  assert.deepEqual(goal.dependsOn.map((item) => item.status), ["done", "parked"]);
  assert.equal(goal.requiredBy[0].status, "open");
});

test("Park is reversible, hidden by default, and remains an unresolved prerequisite", () => {
  const parked = goalStatusChange("active", "parked", " Waiting for the next quarter.\n Keep the evidence. ");
  assert.deepEqual(parked, {
    from: "active",
    status: "parked",
    reason: "Waiting for the next quarter. Keep the evidence.",
    changed: true,
    reopened: false,
    leftVerify: false,
  });
  assert.equal(goalIsTerminal("parked"), false);
  assert.equal(goalIsHiddenByDefault("parked"), true);
  assert.equal(goalIsUnresolved("parked"), true);
  assert.equal(goalIsUnresolved("done"), false);
  assert.equal(goalStatusChange("parked", "open").reopened, true);
});

test("Won't do requires a reason while Park keeps its reason optional", () => {
  assert.throws(() => goalStatusChange("open", "dropped", " "), (error) => error.code === "reason-required");
  assert.equal(goalStatusChange("open", "parked").reason, null);
  assert.equal(goalStatusChange("open", "dropped", "A smaller Goal replaced it.").reason, "A smaller Goal replaced it.");
});

test("live Goal facts control Park confirmation without changing lifecycle authority", () => {
  assert.equal(parkingNeedsConfirmation({ status: "active", session: "worker" }), true);
  assert.equal(parkingNeedsConfirmation({ status: "open", session: "worker" }), true);
  assert.equal(parkingNeedsConfirmation({ status: "open", session: null }), false);
});

test("only Julian marks a Goal flagged verify done; verify is never a direct write", () => {
  assert.throws(() => goalStatusChange("active", "done", "", { actor: "brain", verify: true }), (error) => error.code === "verify-required");
  assert.throws(() => goalStatusChange("active", "done", "", { actor: "worker", verify: true }), (error) => error.code === "verify-required");
  assert.equal(goalStatusChange("verify", "done", "", { actor: "julian", verify: true }).status, "done");
  assert.equal(goalStatusChange("active", "done", "", { actor: "brain", verify: false }).status, "done");
  assert.throws(() => goalStatusChange("active", "verify"), (error) => error.code === "invalid-status");
  assert.equal(goalStatusChange("verify", "open").leftVerify, true);
  assert.equal(goalStatusChange("verify", "done").leftVerify, true);
  assert.equal(goalIsFlaggedForVerify({ verify: true }), true);
  assert.equal(goalIsFlaggedForVerify("yes"), true);
  assert.equal(goalIsFlaggedForVerify(""), false);
  assert.equal(goalWaitsForCheck("verify"), true);
  assert.equal(SETTLED_GOAL_STATUSES.has("verify"), true);
});
