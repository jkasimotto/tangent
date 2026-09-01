import assert from "node:assert/strict";
import test from "node:test";
import { workV3DeskModel } from "./public/work-v3-desk-model.js";

test("the v3 desk model preserves Area and Goal hierarchy with bounded runtime facts", () => {
  const source = { version: "one", condition: "current" };
  const snapshot = {
    schema: "agent-shell-work.v3",
    fence: { areas: source, goals: source, jobs: source, agents: source, brains: source, processes: source, presentations: source },
    areas: [
      { id: "otto", parentId: null, label: "Otto", state: "open", visibility: "work", presented: [], morePresentedCount: 0 },
      { id: "otto/tangent", parentId: "otto", label: "Tangent", state: "open", visibility: "work", presented: [], morePresentedCount: 0 },
    ],
    goals: [
      { id: "otto/tangent/goal-parent.md", areaId: "otto/tangent", parentGoalId: null, title: "Parent", lifecycle: "open", verify: false, visibility: "work", rank: 0, blockers: { state: "ready", count: 0 }, startedAt: "2026-09-01T00:00:00.000Z", workState: { code: "working", owner: "agent", since: "2026-09-01T00:00:01.000Z", evidence: "Current activity" }, execution: { run: 2, revision: 7, state: "open", assignment: { id: "assignment-2", index: 2, total: 3, kind: "implementation", state: "running", label: "Build", instructionPreview: "Build it.", launchRef: { harness: "codex", model: "gpt-5.6-sol", effort: "high" }, agentId: "worker-1", startedAt: "2026-09-01T00:00:00.000Z", endedAt: null }, counts: { total: 3, final: 1, pending: 1 } }, presented: [], morePresentedCount: 0 },
      { id: "otto/tangent/goal-child.md", areaId: "otto/tangent", parentGoalId: "otto/tangent/goal-parent.md", title: "Child", lifecycle: "open", verify: false, visibility: "work", rank: 1, blockers: { state: "blocked", count: 1 }, startedAt: null, workState: { code: "open", owner: "none", since: null, evidence: null }, execution: null, presented: [], morePresentedCount: 0 },
    ],
    agents: [{ id: "worker-1", target: "$1", role: "worker", areaId: "otto/tangent", owner: { kind: "assignment", goalId: "otto/tangent/goal-parent.md", run: 2, assignmentId: "assignment-2" }, liveness: "live", activity: "working", activityDetail: "none", activitySince: "2026-09-01T00:00:01.000Z", evidence: "Current activity", observedAt: "2026-09-01T00:00:02.000Z", contextUsedTokens: 100, cwd: "/tmp/work", launchRef: { harness: "codex", model: "gpt-5.6-sol", effort: "high" }, createdAt: "2026-09-01T00:00:00.000Z", workTitle: null }],
    brains: [{ areaId: "otto/tangent", status: "inactive", generation: 1, attemptId: null, agentId: null, workState: "stopped", attentionCount: 0 }],
    processes: [], problems: [], epoch: "one", revision: 1, publishedAt: "2026-09-01T00:00:03.000Z",
  };

  const result = workV3DeskModel(snapshot);

  assert.deepEqual(result.vault.map.find((group) => group.path === "otto/tangent").goals.map((goal) => [goal.file, goal.depth]), [
    ["otto/tangent/goal-parent.md", 0],
    ["otto/tangent/goal-child.md", 1],
  ]);
  assert.deepEqual(result.pipelines[0].steps.map((step) => step.status), ["complete", "running", "pending"]);
  assert.equal(result.sessions[0].state, "working");
  assert.equal(result.brains[0].state, "stopped");
});
