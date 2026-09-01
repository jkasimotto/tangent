import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkCandidate, createWorkSourceAdapters, retainingAdapter } from "./work-source-adapters.mjs";
import { validateWorkCandidate, workSemanticHash } from "./work-model.mjs";
import { deriveWorkRowState, selectWorkAssignment } from "./work-row-state.mjs";
import path from "node:path";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

/** Creates one normalized retaining-adapter snapshot. */
const fenceSource = (rows = [], condition = "current", problems = []) => ({ rows, condition, version: workSemanticHash(rows), problems });

/** Creates all seven normalized source classes. */
function sources(overrides = {}) {
  return {
    areas: fenceSource([{ id: "otto", parentId: null, label: "Otto", state: "open" }]),
    goals: fenceSource([{ id: "otto/goal-one.md", areaId: "otto", parentGoalId: null, title: "One", lifecycle: "open", verify: false, rank: 0, blockers: { state: "ready", count: 0 }, startedAt: null }]),
    jobs: fenceSource([]), agents: fenceSource([]), brains: fenceSource([]), processes: fenceSource([]), presentations: fenceSource([]),
    ...overrides,
  };
}

test("a bounded Work candidate validates and contains quiet Areas", () => {
  const candidate = buildWorkCandidate(sources());
  assert.equal(candidate.schema, "agent-shell-work.v3");
  assert.deepEqual(candidate.areas.map((row) => row.id), ["otto"]);
  assert.deepEqual(candidate.goals.map((row) => row.id), ["otto/goal-one.md"]);
  assert.deepEqual(candidate.goals[0].workState, { code: "open", owner: "none", since: null, evidence: null });
  assert.equal(validateWorkCandidate(candidate).ok, true);
});

test("the selected Assignment follows live, started, pending, and final precedence", () => {
  const rows = [
    { id: "final", status: "complete", startedAt: "2026-01-01T00:00:00Z" },
    { id: "pending", status: "pending" },
    { id: "started", status: "waiting", startedAt: "2026-01-02T00:00:00Z", session: "old" },
    { id: "live", status: "running", startedAt: "2026-01-03T00:00:00Z", session: "agent" },
  ];
  assert.equal(selectWorkAssignment(rows, new Set(["agent"])).id, "live");
  assert.equal(selectWorkAssignment(rows.slice(0, 3), new Set()).id, "started");
  assert.equal(selectWorkAssignment(rows.slice(0, 2), new Set()).id, "pending");
  assert.equal(selectWorkAssignment(rows.slice(0, 1), new Set()).id, "final");
});

test("a missing Agent never changes canonical Job state", () => {
  const job = {
    id: "otto/goal-one.md#1", goalId: "otto/goal-one.md", run: 1, revision: 4, state: "open",
    assignmentCandidates: [{ id: "assignment-1", index: 1, kind: "implementation", status: "running", label: "Build", instruction: "Build it", session: "gone", startedAt: "2026-01-01T00:00:00.000Z", endedAt: null }],
    counts: { total: 1, final: 0, pending: 0 }, startedAt: "2026-01-01T00:00:00.000Z", endedAt: null,
  };
  const candidate = buildWorkCandidate(sources({ jobs: fenceSource([job]) }));
  assert.equal(candidate.goals[0].execution.state, "open");
  assert.equal(candidate.agents[0].liveness, "absent");
  assert.equal(candidate.goals[0].workState.code, "preparing-validation");
  assert.equal(validateWorkCandidate(candidate).ok, true);
});

test("a failed enumeration retains the last truthful rows", async () => {
  let fails = false;
  const adapter = retainingAdapter("goals", async () => {
    if (fails) throw new Error("read failed");
    return [{ id: "goal", title: "Truth" }];
  });
  await adapter.reconcile();
  fails = true;
  await adapter.reconcile();
  assert.deepEqual(adapter.rows(), [{ id: "goal", title: "Truth" }]);
  assert.equal(adapter.snapshot().condition, "degraded");
  assert.equal(adapter.snapshot().problems[0].code, "source-enumeration-failed");
});

test("source degradation changes candidate identity without removing facts", () => {
  const current = buildWorkCandidate(sources());
  const degraded = buildWorkCandidate(sources({ goals: fenceSource(sources().goals.rows, "degraded", [{ code: "source-enumeration-failed", source: "goals", count: 1, sampleIds: [] }]) }));
  assert.deepEqual(degraded.goals.map((row) => row.id), current.goals.map((row) => row.id));
  assert.notEqual(workSemanticHash(degraded), workSemanticHash(current));
  assert.equal(degraded.goals[0].workState.code, "unknown");
});

test("row state precedence keeps verification and user decisions truthful", () => {
  const base = { lifecycle: "open", startedAt: null };
  assert.equal(deriveWorkRowState({ goal: { ...base, lifecycle: "verify" }, sourcesCurrent: true }).code, "check");
  assert.equal(deriveWorkRowState({ goal: base, agent: { liveness: "live", activity: "waiting", activityDetail: "decision", activitySince: null, evidence: "Choose" }, sourcesCurrent: true }).code, "decision-needed");
  assert.equal(deriveWorkRowState({ goal: base, agent: { liveness: "live", activity: "working", activityDetail: "none", activitySince: null, evidence: "Active" }, sourcesCurrent: true }).code, "working");
});

test("a pane failure keeps complete-list liveness and marks only activity unknown", async () => {
  const { rows } = (await import("./work-source-adapters.mjs")).normalizeOwnedAgents([{ name: "agent-one", target: "$1", goal: "otto/goal-one.md", run: 1, assignment: "assignment-1", fresh: false }]);
  assert.equal(rows[0].liveness, "live");
  assert.equal(rows[0].activity, "unknown");
});

test("duplicate owned Agent identities remain visible once with an explicit problem", async () => {
  const { normalizeOwnedAgents } = await import("./work-source-adapters.mjs");
  const result = normalizeOwnedAgents([
    { name: "agent-one", target: "$1", goal: "otto/goal-one.md", run: 1, assignment: "assignment-1" },
    { name: "agent-one", target: "$2", area: "otto" },
  ]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].owner.kind, "unresolved");
  assert.equal(result.problems.some((item) => item.code === "agent-owner-duplicate"), true);
});

test("the supported Work capacity remains within the one MiB hard limit", () => {
  const areas = Array.from({ length: 250 }, (_, index) => ({ id: `area-${String(index).padStart(3, "0")}`, parentId: null, label: `Area ${index}`, state: "open" }));
  const goals = Array.from({ length: 500 }, (_, index) => ({ id: `${areas[index % areas.length].id}/goal-${String(index).padStart(3, "0")}.md`, areaId: areas[index % areas.length].id, parentGoalId: null, title: `Goal ${index}`, lifecycle: "open", verify: false, rank: index, blockers: { state: "ready", count: 0 }, startedAt: null }));
  const agents = Array.from({ length: 200 }, (_, index) => ({ id: `agent-${String(index).padStart(3, "0")}`, target: `$${index}`, role: "definition", areaId: areas[index % areas.length].id, owner: { kind: "definition", id: `agent-${String(index).padStart(3, "0")}` }, liveness: "live", activity: "working", activityDetail: "none", activitySince: null, evidence: "Active", observedAt: null, contextUsedTokens: null, cwd: null, launchRef: null, createdAt: null, workTitle: `Define ${index}` }));
  const brains = Array.from({ length: 100 }, (_, index) => ({ id: areas[index].id, areaId: areas[index].id, status: "active", generation: 1, attemptId: null, agentId: null, workState: "unknown", attentionCount: 0 }));
  const processes = Array.from({ length: 100 }, (_, index) => ({ id: `${areas[index].id}/process-${index}.md`, areaId: areas[index].id, slug: `process-${index}`, title: `Process ${index}`, status: "active", state: "waiting", stateDetail: null, whenLabel: "every hour", loop: false, bodyPreview: null, due: false, brainLive: false, eventId: null, revision: 1, missedCount: 0, missedSince: null, goalId: null }));
  const presentations = areas.map((area, index) => ({ id: `area:${area.id}`, items: Array.from({ length: index < 50 ? 2 : 1 }, (_, offset) => ({ type: "card", id: `card-${index}-${offset}`, kind: "progress", title: `Update ${index}-${offset}`, summary: "A bounded summary.", presentedBy: "agent", presenterLive: null })), more: 0 }));
  const candidate = buildWorkCandidate(sources({ areas: fenceSource(areas), goals: fenceSource(goals), agents: fenceSource(agents), brains: fenceSource(brains), processes: fenceSource(processes), presentations: fenceSource(presentations) }));
  const validation = validateWorkCandidate(candidate);
  assert.equal(validation.ok, true, validation.errors?.join("\n"));
  assert.ok(validation.bytes <= 1024 * 1024, `capacity candidate is ${validation.bytes} bytes`);
});

test("a 100 MiB external harness log cannot change Work bytes, identity, or read time", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "work-log-proof-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const trees = path.join(root, "trees");
  const runtime = path.join(root, "runtime");
  const external = path.join(root, "harness-logs", "log.jsonl");
  await Promise.all([mkdir(path.join(trees, "otto"), { recursive: true }), mkdir(runtime, { recursive: true }), mkdir(path.dirname(external), { recursive: true })]);
  await writeFile(path.join(trees, "otto", "otto.md"), "# Otto\n\n## Purpose\n\nTest.\n");
  const adapters = createWorkSourceAdapters({ treesRoot: trees, jobsRoot: path.join(runtime, "jobs"), brainsRoot: path.join(runtime, "brains"), processesRoot: path.join(runtime, "processes"), presentationsRoot: path.join(runtime, "presented"),
    /** Returns a complete empty Agent observation. */
    loadAgents: async () => [],
  });
  const before = await adapters.reconcile();
  const file = await open(external, "w");
  await file.truncate(100 * 1024 * 1024);
  await file.close();
  const startedAt = performance.now();
  const after = await adapters.reconcile();
  const elapsed = performance.now() - startedAt;
  assert.equal(workSemanticHash(after), workSemanticHash(before));
  assert.equal(Buffer.byteLength(JSON.stringify(after)), Buffer.byteLength(JSON.stringify(before)));
  assert.ok(elapsed < 1_000, `external growth reconcile took ${elapsed}ms`);
});
