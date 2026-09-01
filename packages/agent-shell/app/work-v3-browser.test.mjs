import assert from "node:assert/strict";
import test from "node:test";
import { bootWorkTable } from "./work-table-harness.mjs";
import { renderWorkV3 } from "./public/work-v3-view.js";
import { WORK_SCHEMA } from "./work-model.mjs";

/** Creates one complete browser Work fixture. */
function snapshot() {
  const source = { version: "source-1", condition: "current" };
  /** Creates one Area fixture row. */
  const area = (id, parentId, label) => ({ id, parentId, label, state: "open", visibility: "work", presented: [], morePresentedCount: 0 });
  const rowState = { code: "working", owner: "agent", since: "2026-09-01T00:00:00.000Z", evidence: "The Agent pane has current activity." };
  return {
    schema: WORK_SCHEMA,
    fence: { areas: source, goals: source, jobs: source, agents: source, brains: source, processes: source, presentations: source },
    areas: [area("otto", null, "Otto"), area("otto/quiet", "otto", "Quiet"), { ...area("otto/tangent", "otto", "Tangent"), presented: [{ type: "card", id: "card-1", kind: "progress", title: "Read model", summary: "The v3 path is active.", presentedBy: "agent-1", presenterLive: true }] }],
    goals: [
      { id: "otto/tangent/goal-parent.md", areaId: "otto/tangent", parentGoalId: null, title: "Build truthful Work", lifecycle: "open", verify: false, visibility: "work", rank: 0, blockers: { state: "ready", count: 0 }, startedAt: "2026-09-01T00:00:00.000Z", workState: rowState, execution: { run: 1, revision: 2, state: "open", assignment: { id: "assignment-1", index: 1, total: 1, kind: "implementation", state: "running", label: "Implement", instructionPreview: "Implement v3.", launchRef: null, agentId: "agent-1", startedAt: "2026-09-01T00:00:00.000Z", endedAt: null }, counts: { total: 1, final: 0, pending: 0 } }, presented: [], morePresentedCount: 0 },
      { id: "otto/tangent/goal-child.md", areaId: "otto/tangent", parentGoalId: "otto/tangent/goal-parent.md", title: "Prove the browser", lifecycle: "open", verify: false, visibility: "work", rank: 1, blockers: { state: "ready", count: 0 }, startedAt: null, workState: { code: "open", owner: "none", since: null, evidence: null }, execution: null, presented: [], morePresentedCount: 0 },
    ],
    agents: [{ id: "agent-1", target: "$1", role: "worker", areaId: "otto/tangent", owner: { kind: "assignment", goalId: "otto/tangent/goal-parent.md", run: 1, assignmentId: "assignment-1" }, liveness: "live", activity: "working", activityDetail: "none", activitySince: "2026-09-01T00:00:00.000Z", evidence: "The Agent pane has current activity.", observedAt: "2026-09-01T00:00:01.000Z", contextUsedTokens: 100, cwd: "/tmp/work", launchRef: null, createdAt: "2026-09-01T00:00:00.000Z", workTitle: null }],
    brains: [{ areaId: "otto/tangent", status: "active", generation: 1, attemptId: "attempt-1", agentId: null, workState: "unknown", attentionCount: 2 }],
    processes: [{ id: "otto/tangent/process-check.md", areaId: "otto/tangent", slug: "check", title: "Check Work", status: "active", state: "waiting", stateDetail: null, whenLabel: "every hour", loop: false, bodyPreview: null, due: false, brainLive: false, eventId: null, revision: 1, missedCount: 0, missedSince: null }],
    problems: [], epoch: "11111111-1111-4111-8111-111111111111", revision: 7, publishedAt: "2026-09-01T00:00:02.000Z",
  };
}

test("browser boot reads only v3 Work and paints every bounded row kind", async () => {
  const fixture = { vault: { areas: [], documents: [] }, sessions: [], brains: [], pipelines: [] };
  const { document, gets } = await bootWorkTable(fixture, { workProjection: snapshot(), workFilter: "all" });
  assert.deepEqual(gets.map((value) => new URL(value).pathname), ["/api/work"]);
  assert.equal(document.querySelector("[data-work-schema='agent-shell-work.v3']") !== null, true);
  assert.equal(document.querySelector("[data-goal-anchor='otto/tangent/goal-parent.md'] .work-state").textContent, "Working");
  assert.equal(document.querySelector("[data-subgoal-of='otto/tangent/goal-parent.md']") !== null, true);
  assert.equal(document.querySelector("[data-process-file='otto/tangent/process-check.md']") !== null, true);
  assert.equal(document.querySelector("[data-work-group='otto/quiet']") !== null, true);
  assert.match(document.body.textContent, /2 questions/);
  assert.match(document.body.textContent, /Read model/);
});

test("stale transport labels the complete prior revision as Last known", () => {
  const html = renderWorkV3({ snapshot: snapshot(), metadata: { state: "stale", staleReason: "controller-recovery" } });
  assert.match(html, /Last known/);
  assert.match(html, /Build truthful Work/);
});

test("collapsed v3 Goal hierarchy hides descendants without changing facts", () => {
  const html = renderWorkV3({ snapshot: snapshot(), metadata: { state: "current" }, collapsedGoals: new Set(["otto/tangent/goal-parent.md"]) });
  assert.match(html, /Build truthful Work/);
  assert.doesNotMatch(html, /Prove the browser/);
});
