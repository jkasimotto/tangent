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

test("runtime invariant sweep reports all six corrupted Process states as Problems", () => {
  const processFile = "a/process-nightly.md";
  const eventId = "event-1";
  /** Builds one Process attempt fixture. */
  const attempt = (id, status, fields = {}) => ({
    id, status, trigger: "julian", requestedAt: "2026-08-31T00:00:00Z",
    deadlineAt: "2026-08-31T00:30:00Z", ...fields,
  });
  const processes = [
    {
      file: processFile, area: "a", state: { auto: { disabledAt: null }, currentEvent: {
        id: eventId, status: "running", goalFile: "a/goal-nightly-a.md", job: { run: 1 },
        attempts: [attempt("open-1", "accepted"), attempt("open-2", "job-created")],
      } },
    },
    {
      file: "a/process-broken-running.md", area: "a", state: { auto: { disabledAt: null }, currentEvent: {
        id: "event-missing", status: "running", goalFile: "a/goal-missing.md", job: { run: 4 }, attempts: [],
      } },
    },
    {
      file: "a/process-breaker.md", area: "a", state: { auto: { disabledAt: "2026-08-31T00:10:00Z" }, currentEvent: {
        id: "event-breaker", status: "running", goalFile: "a/goal-breaker.md", job: { run: 1 },
        attempts: [attempt("auto-late", "started", { trigger: "auto", requestedAt: "2026-08-31T00:11:00Z" })],
      } },
    },
  ];
  const jobs = [
    { goal: "a/goal-nightly-a.md", runs: [{ run: 1, origin: { kind: "process", processFile: "a/process-other.md", eventId } }] },
    { goal: "a/goal-nightly-b.md", runs: [{ run: 1, origin: { kind: "process", processFile, eventId } }] },
    { goal: "a/goal-nightly-c.md", runs: [{ run: 1, origin: { kind: "process", processFile, eventId } }] },
    { goal: "a/goal-breaker.md", runs: [{ run: 1, origin: { kind: "process", processFile: "a/process-breaker.md", eventId: "event-breaker" } }] },
  ];
  const codes = runtimeInvariantProblems({ processes, jobs, now: Date.parse("2026-08-31T01:00:00Z") }).map((problem) => problem.code);
  assert.deepEqual(new Set(codes), new Set([
    "process-event-multiple-goals",
    "process-job-origin-mismatch",
    "process-running-without-job",
    "process-multiple-nonterminal-attempts",
    "process-start-deadline-passed",
    "process-auto-start-after-breaker",
  ]));
});
