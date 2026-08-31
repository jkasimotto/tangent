import test from "node:test";
import assert from "node:assert/strict";
import { runtimeInvariantProblems } from "./runtime-invariants.mjs";

test("runtime invariant sweep reports crossed authority boundaries", () => {
  const problems = runtimeInvariantProblems({
    now: Date.parse("2026-08-31T01:00:00Z"),
    goals: [{ file: "a/goal-x.md", status: "done", session: "missing" }],
    jobs: [{ goal: "a/goal-x.md", currentRun: 2, runs: [
      { run: 1, status: "open", assignments: [] },
      { run: 2, status: "open", assignments: [{ attempts: [{ id: "try-1", session: "worker", endedAt: null }] }] },
    ] }],
    brains: [{ area: "a", session: "brain-2", generation: 2, generations: [
      { session: "brain-1", generation: 1, state: "active" },
      { session: "brain-2", generation: 2, state: "active" },
    ], succession: { id: "op", status: "starting", deadlineAt: "2026-08-31T00:00:00Z", source: { session: "brain-1" } } }],
    agents: [],
  });
  assert.deepEqual(problems.map((problem) => problem.code), ["multiple-mutable-job-runs", "attempt-on-terminal-goal", "binding-without-current-attempt", "multiple-authoritative-generations", "staged-successor-deadline"]);
});

test("runtime invariant sweep reports an outgoing Agent still live after promotion", () => {
  const problems = runtimeInvariantProblems({
    brains: [{ area: "a", generations: [], succession: { id: "op", status: "promoted", source: { session: "brain-1" } } }],
    agents: [{ name: "brain-1", live: true }],
  });
  assert.equal(problems[0]?.code, "promoted-outgoing-live");
});
