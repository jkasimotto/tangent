import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkCandidate, createWorkSourceAdapters, retainingAdapter } from "./work-source-adapters.mjs";
import { validateWorkCandidate, workSemanticHash } from "./work-model.mjs";
import { deriveWorkRowState, selectWorkAssignment } from "./work-row-state.mjs";
import path from "node:path";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { newPipeline, writePipeline } from "./job-record.mjs";
import { newBrain, writeBrain } from "./brain-record.mjs";

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

test("a final Assignment does not retain a dead Agent or a closed Goal", () => {
  const finalJob = {
    id: "otto/goal-one.md#1", goalId: "otto/goal-one.md", run: 1, revision: 4, state: "complete",
    assignmentCandidates: [{ id: "assignment-1", index: 1, kind: "implementation", status: "complete", label: "Build", instruction: "Build it", session: "finished-agent", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T01:00:00.000Z" }],
    counts: { total: 1, final: 1, pending: 0 }, startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T01:00:00.000Z",
  };
  const openCandidate = buildWorkCandidate(sources({ jobs: fenceSource([finalJob]) }));
  assert.equal(openCandidate.agents.length, 0);
  assert.equal(openCandidate.goals[0].execution.assignment.agentId, null);
  assert.equal(validateWorkCandidate(openCandidate).ok, true);

  const closedGoal = { ...sources().goals.rows[0], lifecycle: "done" };
  const closedCandidate = buildWorkCandidate(sources({ goals: fenceSource([closedGoal]), jobs: fenceSource([finalJob]) }));
  assert.equal(closedCandidate.agents.length, 0);
  assert.equal(closedCandidate.goals.length, 0);
  assert.equal(validateWorkCandidate(closedCandidate).ok, true);
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
  const { rows, problems } = (await import("./work-source-adapters.mjs")).normalizeOwnedAgents([{ name: "agent-one", target: "$1", goal: "otto/goal-one.md", run: 1, assignment: "assignment-1", fresh: false }]);
  assert.equal(rows[0].liveness, "live");
  assert.equal(rows[0].activity, "unknown");
  assert.deepEqual(problems, [{ code: "agent-pane-failed", ids: ["agent-one"] }]);
});

test("a legacy queue remains a truthful current Job until the separate source migration", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "work-legacy-job-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const trees = path.join(root, "trees");
  const runtime = path.join(root, "runtime");
  await Promise.all([
    mkdir(path.join(trees, "otto"), { recursive: true }),
    mkdir(path.join(runtime, "jobs", "otto"), { recursive: true }),
  ]);
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: work\nstatus: active\n---\n\n# Otto\n");
  await writeFile(path.join(trees, "otto", "goal-one.md"), "---\ntype: goal\nstatus: active\n---\n\n# One\n");
  await writeFile(path.join(runtime, "jobs", "otto", "one.json"), JSON.stringify({
    schema: "area-goal-queue.v2",
    goal: "otto/goal-one.md",
    area: "otto",
    organizerArea: "otto",
    slug: "one",
    revision: 7,
    status: "open",
    assignments: [{ id: "assignment-1", index: 1, kind: "implementation", status: "pending", label: "Build", instruction: "Build the result.", attempts: [], reports: [] }],
  }));
  const adapters = createWorkSourceAdapters({
    treesRoot: trees,
    jobsRoot: path.join(runtime, "jobs"),
    brainsRoot: path.join(runtime, "brains"),
    processesRoot: path.join(runtime, "processes"),
    presentationsRoot: path.join(runtime, "presented"),
    /** Returns one complete empty Agent observation. */
    /** Returns one complete empty Agent observation. */
    loadAgents: async () => [],
  });

  const candidate = await adapters.reconcile();

  assert.equal(candidate.fence.jobs.condition, "current");
  assert.equal(candidate.goals[0].execution.state, "open");
  assert.equal(candidate.goals[0].execution.revision, 7);
  assert.equal(candidate.goals[0].execution.assignment.id, "assignment-1");
  assert.equal(candidate.goals[0].workState.code, "assignment-pending");
});

test("a canonical job.v1 uses its file-level Goal identity", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "work-canonical-job-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const trees = path.join(root, "trees");
  const jobs = path.join(root, "jobs");
  await mkdir(path.join(trees, "otto"), { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: work\nstatus: active\n---\n\n# Otto\n");
  await writeFile(path.join(trees, "otto", "goal-one.md"), "---\ntype: goal\nstatus: active\n---\n\n# One\n");
  await writePipeline(jobs, newPipeline({
    goal: "otto/goal-one.md",
    area: "otto",
    slug: "one",
    now: "2026-09-01T00:00:00.000Z",
    steps: [{ instruction: "Build the result.", launch: { harness: "codex", model: "gpt-5.6-sol", effort: "high" } }],
  }));
  const adapters = createWorkSourceAdapters({
    treesRoot: trees,
    jobsRoot: jobs,
    brainsRoot: path.join(root, "brains"),
    processesRoot: path.join(root, "processes"),
    presentationsRoot: path.join(root, "presented"),
    /** Returns one complete empty Agent observation. */
    loadAgents: async () => [],
  });

  const candidate = await adapters.reconcile();

  assert.equal(candidate.fence.jobs.condition, "current");
  assert.equal(candidate.problems.some((problem) => problem.source === "jobs" && problem.code === "source-record-invalid"), false);
  assert.equal(candidate.goals[0].execution.run, 1);
  assert.equal(candidate.goals[0].execution.assignment.instructionPreview, "Build the result.");
});

test("corrupt Job and Brain files retain their last truthful rows", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "work-corrupt-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const trees = path.join(root, "trees");
  const jobs = path.join(root, "jobs");
  const brains = path.join(root, "brains");
  await mkdir(path.join(trees, "otto"), { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: work\nstatus: active\n---\n\n# Otto\n");
  await writeFile(path.join(trees, "otto", "goal-one.md"), "---\ntype: goal\nstatus: active\n---\n\n# One\n");
  await writePipeline(jobs, newPipeline({
    goal: "otto/goal-one.md",
    area: "otto",
    slug: "one",
    now: "2026-09-01T00:00:00.000Z",
    steps: [{ instruction: "Build the result.", launch: { harness: "codex" } }],
  }));
  await writeBrain(brains, newBrain({ area: "otto", instruction: "", planFile: "otto/otto.md", now: "2026-09-01T00:00:00.000Z" }));
  const adapters = createWorkSourceAdapters({
    treesRoot: trees,
    jobsRoot: jobs,
    brainsRoot: brains,
    processesRoot: path.join(root, "processes"),
    presentationsRoot: path.join(root, "presented"),
    /** Returns one complete empty Agent observation. */
    loadAgents: async () => [],
  });
  const before = await adapters.reconcile();
  assert.equal(before.goals[0].execution.assignment.id, "assignment-1");
  assert.equal(before.brains.length, 1);

  await writeFile(path.join(jobs, "otto", "one.json"), "{");
  await writeFile(path.join(brains, "otto", "brain.json"), "{");
  const after = await adapters.reconcile(["jobs", "brains"]);

  assert.equal(after.goals[0].execution.assignment.id, "assignment-1");
  assert.equal(after.brains.length, 1);
  assert.equal(after.fence.jobs.condition, "degraded");
  assert.equal(after.fence.brains.condition, "degraded");
  assert.equal(after.problems.some((item) => item.source === "jobs" && item.code === "source-record-invalid"), true);
  assert.equal(after.problems.some((item) => item.source === "brains" && item.code === "source-record-invalid"), true);
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
  const processes = Array.from({ length: 100 }, (_, index) => ({ id: `${areas[index].id}/process-${index}.md`, areaId: areas[index].id, slug: `process-${index}`, title: `Process ${index}`, status: "active", state: "waiting", stateDetail: null, whenLabel: "every hour", loop: false, bodyPreview: null, visibleInWork: false, due: false, brainLive: false, eventId: null, revision: 1, missedCount: 0, missedSince: null, goalId: null }));
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
