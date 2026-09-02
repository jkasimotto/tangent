import assert from "node:assert/strict";
import test from "node:test";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
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
    areas: [area("otto", null, "Otto"), area("otto/quiet", "otto", "Quiet"), { ...area("otto/tangent", "otto", "Tangent"), presented: [{ type: "document", id: "document-1", file: "otto/tangent/design-read-model.md", root: "vault", repository: null, title: "Read model", note: "The v3 path is active.", presentedBy: "agent-1", presentedHash: "hash-1" }] }],
    goals: [
      { id: "otto/tangent/goal-parent.md", areaId: "otto/tangent", parentGoalId: null, title: "Build truthful Work", lifecycle: "open", verify: false, visibility: "work", rank: 0, blockers: { state: "ready", count: 0 }, startedAt: "2026-09-01T00:00:00.000Z", workState: rowState, execution: { run: 1, revision: 2, state: "open", assignment: { id: "assignment-1", index: 1, total: 1, kind: "implementation", state: "running", label: "Implement", instructionPreview: "Implement v3.", launchRef: null, agentId: "agent-1", startedAt: "2026-09-01T00:00:00.000Z", endedAt: null }, counts: { total: 1, final: 0, pending: 0 } }, presented: [], morePresentedCount: 0 },
      { id: "otto/tangent/goal-child.md", areaId: "otto/tangent", parentGoalId: "otto/tangent/goal-parent.md", title: "Prove the browser", lifecycle: "open", verify: false, visibility: "work", rank: 1, blockers: { state: "ready", count: 0 }, startedAt: null, workState: { code: "open", owner: "none", since: null, evidence: null }, execution: null, presented: [], morePresentedCount: 0 },
    ],
    agents: [{ id: "agent-1", target: "$1", role: "worker", areaId: "otto/tangent", owner: { kind: "assignment", goalId: "otto/tangent/goal-parent.md", run: 1, assignmentId: "assignment-1" }, liveness: "live", activity: "working", activityDetail: "none", activitySince: "2026-09-01T00:00:00.000Z", evidence: "The Agent pane has current activity.", observedAt: "2026-09-01T00:00:01.000Z", contextUsedTokens: 100, cwd: "/tmp/work", launchRef: null, createdAt: "2026-09-01T00:00:00.000Z", workTitle: null }],
    brains: [{ areaId: "otto/tangent", status: "active", generation: 1, attemptId: "attempt-1", agentId: null, workState: "unknown", attentionCount: 2 }],
    processes: [
      { id: "otto/tangent/process-check.md", areaId: "otto/tangent", slug: "check", title: "Check Work", status: "active", state: "waiting", stateDetail: null, whenLabel: "every hour", loop: false, bodyPreview: null, visibleInWork: false, due: false, brainLive: false, eventId: null, revision: 1, missedCount: 0, missedSince: null },
      { id: "otto/tangent/process-due.md", areaId: "otto/tangent", slug: "due", title: "Due Work", status: "active", state: "waiting-for-brain", stateDetail: null, whenLabel: "daily", loop: false, bodyPreview: null, visibleInWork: true, due: true, brainLive: false, eventId: "due-event", revision: 2, missedCount: 0, missedSince: null },
    ],
    problems: [], epoch: "11111111-1111-4111-8111-111111111111", revision: 7, publishedAt: "2026-09-01T00:00:02.000Z",
  };
}

/** Adds an unrelated definition session that attention lenses must suppress. */
function withDefinition(projection) {
  projection.agents.push({
    id: "definition-1", target: "definition-1", role: "definition", areaId: "otto/tangent", owner: { kind: "none", id: null },
    liveness: "live", activity: "working", activityDetail: "none", activitySince: "2026-09-01T00:00:00.000Z",
    evidence: "The definition Agent is working.", observedAt: "2026-09-01T00:00:01.000Z", contextUsedTokens: 10,
    cwd: "/tmp/work", launchRef: null, createdAt: "2026-09-01T00:00:00.000Z", workTitle: "Unrelated definition",
  });
  return projection;
}

/** Persists every old Work scope before returning to Map. */
async function narrowThenCloseWork(window, document) {
  document.querySelector("[data-active-only]").click();
  await settle(window);
  document.querySelector("[data-close-work-lens]").click();
  await settle(window);
}

test("browser boot starts Map, reads only v3 Work, and paints every bounded row kind", async () => {
  const fixture = { vault: { areas: [], documents: [] }, sessions: [], brains: [], pipelines: [] };
  const { document, gets } = await bootWorkTable(fixture, { workProjection: snapshot(), workFilter: "all" });
  const paths = gets.map((value) => new URL(value).pathname);
  assert.equal(paths[0], "/api/areas/map-world", "the durable Map starts before the Work projection");
  assert.equal(paths.filter((value) => value === "/api/work").length, 1, "Work has one v3 read path");
  assert.ok(paths.every((value) => ["/api/areas/map-world", "/api/work"].includes(value)), "boot never reads a legacy Work source");
  assert.deepEqual([...document.querySelectorAll(".work-table thead th")].map((cell) => cell.textContent.trim()), ["Goal", "Agent", "Status", "Controls"]);
  assert.equal(document.querySelector("[data-goal-anchor='otto/tangent/goal-parent.md'] .desk-state").textContent, "Working");
  assert.equal(document.querySelector("[data-subgoal-of='otto/tangent/goal-parent.md']") !== null, true);
  assert.equal(document.querySelector("[data-process-file='otto/tangent/process-check.md']"), null, "a future definition is not Work");
  assert.equal(document.querySelector("[data-process-file='otto/tangent/process-due.md']") !== null, true, "a due occurrence is Work");
  assert.equal(document.querySelector("[data-work-area='otto/quiet']") !== null, true);
  assert.match(document.body.textContent, /2 questions/);
  assert.match(document.body.textContent, /Read model/);
});

test("bounded source diagnostics stay quiet on Work and become deduplicated Problems", async () => {
  const projection = snapshot();
  projection.problems = [
    { code: "source-record-invalid", source: "jobs", count: 412, sampleIds: ["one", "two", "three"] },
    { code: "brain-agent-missing", source: "brains", count: 17, sampleIds: ["otto/tangent"] },
  ];
  const { window, document } = await bootWorkTable({ vault: { areas: [], documents: [] }, sessions: [], brains: [], pipelines: [] }, { workProjection: projection });
  assert.match(document.body.textContent, /Build truthful Work/);
  assert.doesNotMatch(document.body.textContent, /Last known|source-record-invalid|brain-agent-missing|412|17 missing/);
  document.querySelector("#problems-button").click();
  await settle(window);
  assert.match(document.querySelector(".work-caption-count").textContent, /^429 items$/, "one concrete unknown Brain deduplicates one of 17 missing-Brain diagnostics");
  assert.match(document.querySelector('[data-problem-code="source-record-invalid"]').textContent, /412 problems/);
  assert.match(document.querySelector('[data-problem-code="brain-agent-missing"]').textContent, /16 problems/);
});

test("v3 rows preserve the established hierarchy, fold keys, cursor, and Agent entry", async () => {
  const fixture = { vault: { areas: [], documents: [] }, sessions: [{ name: "agent-1", area: "otto/tangent", goal: "otto/tangent/goal-parent.md", kind: "goal", state: "working" }], brains: [], pipelines: [] };
  const { window, document, gets } = await bootWorkTable(fixture, { workProjection: snapshot(), workFilter: "all" });
  const parent = document.querySelector("[data-goal-anchor='otto/tangent/goal-parent.md']");
  const child = document.querySelector("[data-goal-anchor='otto/tangent/goal-child.md']");
  parent.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  parent.querySelector("[data-work-row-title]").focus();
  press(window, "h");
  await settle(window);
  assert.equal(document.querySelector("[data-goal-anchor='otto/tangent/goal-child.md']").hidden, true);
  press(window, "l");
  await settle(window);
  assert.equal(document.querySelector("[data-goal-anchor='otto/tangent/goal-child.md']").hidden, false);
  const enter = press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window);
  assert.equal(enter.defaultPrevented, true, `the session key is owned from ${document.activeElement?.outerHTML}`);
  assert.ok(gets.some((value) => new URL(value).pathname === "/api/agents/show"));
  assert.equal(document.querySelector("#session-layer").hidden, false);
});

test("For you uses bounded attention and ignores every persisted general Work filter", async () => {
  const projection = withDefinition(snapshot());
  projection.areas.find((area) => area.id === "otto/tangent").state = "archived";
  projection.goals[0].workState = { code: "waiting", owner: "user", since: "2026-09-01T00:00:03.000Z", evidence: "A direct decision is required." };
  projection.agents[0].activity = "waiting";
  projection.agents[0].activityDetail = "decision";
  const fixture = { vault: { areas: [], documents: [] }, sessions: [], brains: [], pipelines: [] };
  const { window, document } = await bootWorkTable(fixture, {
    workProjection: projection,
    workFilter: "inactive",
    areaFocus: ["otto/quiet"],
    areaFocusOnly: true,
  });

  await narrowThenCloseWork(window, document);
  document.querySelector("#for-you-button").click();
  await settle(window);

  assert.equal(document.querySelector("#work-lens-title").textContent, "For you");
  assert.match(document.querySelector(".work-caption-count").textContent, /^3 items$/, "two Brain items and one Goal item use the same bounded count as the global entry");
  assert.equal(document.querySelectorAll(".work-attention-item.for-you").length, 2, "Brain attention is one aggregate row and the direct Goal is one row");
  assert.ok(document.querySelector("[data-goal-anchor='otto/tangent/goal-parent.md'].work-attention-item"), "the bounded user-owned Goal survives the legacy inactive filter and Brain coverage");
  assert.match(document.querySelector(".work-attention-item.for-you").textContent, /2 direct items from Otto \/ Tangent Brain/);
  assert.equal(document.querySelector("[data-goal-anchor='otto/tangent/goal-child.md']"), null, "a routine sibling Goal is not an attention item");
  assert.equal(document.querySelector(".presented-document"), null, "presentations do not leak into For you");
  assert.equal(document.querySelector(".work-process-row"), null, "routine Processes do not leak into For you");
  assert.equal(document.querySelector(".desk-definition"), null, "definition sessions do not leak into For you");
  assert.equal(document.querySelector(".work-caption [data-starred-only], .work-caption [data-active-only]"), null, "ignored general filters are not advertised inside the attention lens");
});

test("Problems renders every bounded consequence, including hidden Processes and an Agent without an Area", async () => {
  const projection = withDefinition(snapshot());
  projection.areas.find((area) => area.id === "otto/tangent").state = "archived";
  projection.goals[0].blockers = { state: "cycle", count: 1 };
  projection.agents[0].liveness = "unknown";
  projection.agents[0].activity = "unknown";
  projection.agents[0].evidence = "The last runtime observation failed.";
  projection.processes[1] = { ...projection.processes[1], state: "broken", stateDetail: "Schedule syntax is invalid.", visibleInWork: false, due: false };
  projection.agents.push({
    id: "orphan-agent", target: "orphan-agent", role: "worker", areaId: null, owner: { kind: "none", id: null },
    liveness: "unknown", activity: "unknown", activityDetail: "none", activitySince: null,
    evidence: "No owning Area could be recovered.", observedAt: "2026-09-01T00:00:01.000Z", contextUsedTokens: null,
    cwd: null, launchRef: null, createdAt: "2026-09-01T00:00:00.000Z", workTitle: "Unassigned recovery",
  });
  projection.problems = [
    { code: "brain-agent-missing", source: "brains", count: 1, sampleIds: ["otto/tangent"] },
    { code: "agent-owner-unresolved", source: "model", count: 2, sampleIds: ["owner-a", "owner-b"] },
  ];
  const fixture = { vault: { areas: [], documents: [] }, sessions: [], brains: [], pipelines: [] };
  const { window, document } = await bootWorkTable(fixture, {
    workProjection: projection,
    workFilter: "inactive",
    areaFocus: ["otto/quiet"],
    areaFocusOnly: true,
  });

  await narrowThenCloseWork(window, document);
  document.querySelector("#problems-button").click();
  await settle(window);

  assert.equal(document.querySelector("#work-lens-title").textContent, "Problems");
  assert.match(document.querySelector(".work-caption-count").textContent, /^7 items$/, "five concrete consequences and two bounded ownership failures use the same global count");
  assert.equal(document.querySelectorAll(".work-attention-item.problems").length, 6, "five concrete consequences and one bounded aggregate row stay visible");
  assert.ok(document.querySelector("[data-goal-anchor='otto/tangent/goal-parent.md'].work-attention-item"));
  assert.equal(document.querySelector("[data-goal-anchor='otto/tangent/goal-child.md']"), null, "a healthy Goal is not a Problem row");
  assert.equal(document.querySelectorAll(".work-process-row").length, 1, "only the broken Process is shown even though it was hidden from general Work");
  assert.match(document.querySelector(".work-process-row").textContent, /Schedule syntax is invalid/);
  assert.match(document.querySelector(".work-unassigned-problems").textContent, /Unassigned recovery/);
  assert.match(document.body.textContent, /The last runtime observation failed/);
  assert.match(document.querySelector('[data-problem-code="agent-owner-unresolved"]').textContent, /2 problems/);
  assert.equal(document.querySelector('[data-problem-code="brain-agent-missing"]'), null, "the missing Brain diagnostic is represented once by its exact Brain consequence");
  assert.equal(document.querySelector(".presented-document"), null);
  assert.equal(document.querySelector(".desk-definition"), null);
  assert.ok(document.querySelector("[data-open-area-brain]"), "a Brain problem has a safe Brain route");
  assert.ok(document.querySelector("[data-open-close='otto/tangent/goal-parent.md']"), "an Agent failure can inspect its owning Goal");
  assert.ok(document.querySelector(".work-process-row [data-open-document]"), "a Process failure can inspect its definition");
});
