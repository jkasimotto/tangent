import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";

const launchOptions = {
  area: "otto/tangent",
  harnesses: [
    {
      id: "codex", label: "Codex", command: "codex",
      models: [{ id: "sol", label: "Sol", args: "--model sol", efforts: [{ id: "low", label: "Low", args: "--effort low" }, { id: "high", label: "High", args: "--effort high" }] }],
    },
    { id: "claude", label: "Claude", command: "claude", models: [{ id: "opus", label: "Opus", args: "--model opus" }] },
  ],
  default: { harness: "codex", model: "sol", effort: "low", label: "Codex · Sol · Low", command: "codex --model sol --effort low", source: "otto/tangent" },
};

/** Adds the stable queue and attempt fences Change agent requires. */
function replacementFixture() {
  const fixture = workTableFixture();
  const file = "otto/tangent/goal-compact-table.md";
  const sourceSession = "tangent--table";
  const replacementSession = "tangent--table-r2";
  const assignment = {
    id: "assignment-current",
    index: 1,
    status: "running",
    live: true,
    session: sourceSession,
    instruction: "Build the compact Work table.",
    kind: "implementation",
    path: "packages/agent-shell/app/public",
    continueFromAssignmentId: null,
    launch: { harness: "codex", model: "sol", effort: "low" },
    attempts: [{
      id: "attempt-source",
      session: sourceSession,
      status: "running",
      current: true,
      resolvedLaunch: { harness: "codex", model: "sol", effort: "low" },
    }],
  };
  const pipeline = {
    goal: file,
    area: "otto/tangent",
    slug: "compact-table",
    revision: 7,
    status: "running",
    currentAssignmentId: assignment.id,
    steps: [assignment, {
      id: "assignment-review",
      index: 2,
      status: "pending",
      instruction: "Review the finished interaction.",
      kind: "review",
      path: "packages/agent-shell/app",
      continueFromAssignmentId: assignment.id,
      launch: { harness: "codex", model: "sol", effort: "high" },
      attempts: [],
    }],
  };
  fixture.pipelines = fixture.pipelines.map((record) => record.goal === file ? pipeline : record);
  return { fixture, file, sourceSession, replacementSession, assignment, pipeline };
}

/** Creates the failed HTTP response shape used by the browser API client. */
function errorResponse(payload, status = 409) {
  return {
    ok: false,
    status,
    headers: {
      /** The fixture has no retry or operation response headers. */
      get() { return null; },
    },
    /** Returns the configured server error. */
    async json() { return payload; },
  };
}

/** One durable replacement operation projected by the server. */
function operation(body, status, replacementSession, error = "") {
  return {
    id: body.operationId,
    status,
    goal: body.goal,
    assignmentId: body.assignmentId,
    sourceAttemptId: body.expectedAttemptId,
    sourceTarget: { session: "tangent--table" },
    replacementTarget: { session: replacementSession },
    ...(error ? { error } : {}),
  };
}

test("c and the Goal pointer action run one no-loss replacement through inspection and exact confirmation", async () => {
  const { fixture, file, sourceSession, replacementSession, assignment, pipeline } = replacementFixture();
  let replacementCall = 0;
  const { window, document, posts } = await bootWorkTable(fixture, {
    launchOptions,
    /** Simulates the confirmable replacement route without touching tmux. */
    postHandler: ({ path, body }) => {
      if (path !== "/api/goals/attempts/replace") return { ok: true };
      replacementCall += 1;
      if (replacementCall === 1) {
        fixture.sessions.push({ name: replacementSession, goal: file, state: "working", command: "claude", created: Date.now() });
        return {
          state: "replacement-starting",
          session: replacementSession,
          requiresConfirmation: true,
          operation: operation(body, "replacement-starting", replacementSession),
          pipeline,
        };
      }
      if (replacementCall === 2) {
        return errorResponse({
          code: "retirement-incomplete",
          error: "The exact source retirement did not complete; both sessions remain live.",
          operation: operation(body, "retirement-incomplete", replacementSession, "Exact source target mismatch."),
          pipeline,
        });
      }
      return {
        state: "complete",
        session: replacementSession,
        operation: operation(body, "complete", replacementSession),
        pipeline,
      };
    },
  });

  const unavailableRow = document.querySelector("[data-goal-anchor='otto/tangent/goal-voice-dump.md']");
  unavailableRow.querySelector("[data-work-object-actions]").click();
  await settle(window);
  const unavailable = document.querySelector("[data-modal-action='changeAgent']");
  assert.equal(unavailable.getAttribute("aria-disabled"), "true", "a non-current Goal cannot pretend it has an attempt to replace");
  assert.match(unavailable.textContent, /no current assignment/i, "the pointer action explains why it is unavailable");
  press(window, "Escape");

  let row = document.querySelector(`[data-goal-anchor='${file}']`);
  const pointer = row.querySelector("[data-work-object-actions]");
  pointer.click();
  await settle(window);
  const pointerAction = document.querySelector("[data-modal-action='changeAgent']");
  assert.equal(pointerAction.dataset.modalKey, "c", "the pointer path teaches the keyboard shortcut");
  assert.notEqual(pointerAction.getAttribute("aria-disabled"), "true");
  pointerAction.click();
  await settle(window, 5);
  assert.equal(document.querySelector("[data-launch-popover]")?.getAttribute("aria-label"), "Change agent");
  assert.equal(document.querySelector("[data-launch-harness='codex']")?.getAttribute("aria-checked"), "true", "the chooser starts from the current attempt launch");
  assert.match(document.querySelector(".replacement-preserved").textContent, /Build the compact Work table/);
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement.dataset.focusKey, pointer.dataset.focusKey, "pointer Back returns to the exact Goal action opener");

  row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const title = row.querySelector("[data-work-row-title]");
  title.focus();
  press(window, "c");
  await settle(window, 5);
  assert.equal(document.activeElement.dataset.launchHarness, "codex", "c enters the same chooser without a pointer");
  press(window, "j");
  assert.equal(document.activeElement.dataset.launchHarness, "claude");
  press(window, "Enter");
  await settle(window);
  const start = document.querySelector("[data-launch-start]");
  start.focus();
  press(window, "Enter");
  await settle(window, 8);

  /** Returns only the replacement requests from this interaction. */
  const calls = () => posts.filter((entry) => entry.path === "/api/goals/attempts/replace");
  assert.equal(calls().length, 1);
  const first = calls()[0].body;
  assert.deepEqual(first, {
    goal: file,
    assignmentId: assignment.id,
    expectedRevision: 7,
    expectedAttemptId: "attempt-source",
    launch: { harness: "claude", model: "opus", effort: null },
    operationId: first.operationId,
  });
  assert.match(first.operationId, /^[0-9a-f-]{20,}$/i);
  assert.equal("confirmed" in first, false, "the inspection request cannot retire the source");
  assert.ok(fixture.sessions.some((session) => session.name === sourceSession), "the source is still live before confirmation");
  assert.equal(document.querySelector("#session-layer").hidden, false, "the browser automatically opens the replacement for inspection");
  assert.equal(document.querySelector("#session-layer-terminal").dataset.session, replacementSession);
  assert.equal(posts.some((entry) => entry.path.includes("kill") || entry.path.includes("stop")), false, "the browser never kills the source itself");

  document.querySelector("[data-close-session-layer]").click();
  await settle(window, 4);
  row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.querySelector("[data-work-row-title]").focus();
  press(window, "c");
  await settle(window, 5);
  assert.match(document.querySelector(".replacement-state").textContent, /replacement starting/i);
  assert.equal(document.activeElement.dataset.focusKey, "launch:start", "returning to the unsettled operation starts at Finish replacement");
  press(window, "Enter");
  await settle(window, 5);

  assert.equal(calls().length, 2);
  const second = calls()[1].body;
  assert.deepEqual(second, { ...first, confirmed: true }, "Finish reuses every fence and the same operation ID");
  assert.match(document.querySelector(".replacement-state.retirement-incomplete").textContent, /both sessions remain visible/i);
  assert.match(document.querySelector("[data-launch-start]").textContent, /Retry exact retirement/);
  assert.ok(fixture.sessions.some((session) => session.name === sourceSession));
  assert.ok(fixture.sessions.some((session) => session.name === replacementSession));

  document.querySelector("[data-launch-start]").focus();
  press(window, "Enter");
  await settle(window, 6);
  assert.equal(calls().length, 3);
  assert.deepEqual(calls()[2].body, second, "an incomplete exact retirement retries the persisted operation instead of launching again");
  assert.match(document.querySelector(".replacement-state.complete").textContent, /Goal and assignment identity were preserved/i);
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement.dataset.focusKey, title.dataset.focusKey, "Escape restores the exact keyboard opener after completion");
  window.close();
});

test("a failed replacement stays visible and leaves the source current", async () => {
  const { fixture, file, sourceSession, replacementSession, pipeline } = replacementFixture();
  const { window, document, posts } = await bootWorkTable(fixture, {
    launchOptions,
    /** Refuses replacement startup while returning its durable operation evidence. */
    postHandler: ({ path, body }) => path === "/api/goals/attempts/replace"
      ? errorResponse({
          code: "replacement-start-failed",
          error: "Replacement startup failed; the source stayed current.",
          operation: operation(body, "failed", replacementSession, "The replacement process did not become live."),
          pipeline,
        })
      : { ok: true },
  });
  const row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const title = row.querySelector("[data-work-row-title]");
  title.focus();
  press(window, "c");
  await settle(window, 5);
  document.querySelector("[data-launch-start]").focus();
  press(window, "Enter");
  await settle(window, 5);

  assert.match(document.querySelector(".replacement-state.failed").textContent, /source attempt stayed current and alive/i);
  assert.match(document.querySelector(".replacement-state.failed").textContent, /did not become live/i);
  assert.ok(fixture.sessions.some((session) => session.name === sourceSession));
  assert.equal(document.querySelector("#session-layer").hidden, true, "a failed successor is never opened as though it were current");
  assert.equal(posts.some((entry) => entry.path.includes("kill") || entry.path.includes("stop")), false);
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement.dataset.focusKey, title.dataset.focusKey);
  window.close();
});

test("the Goal reader exposes Change agent through the shared chooser and restores its exact opener", async () => {
  const { fixture, file, assignment, pipeline } = replacementFixture();
  const goal = fixture.goals.find((item) => item.file === file);
  const detail = {
    goal,
    markdown: "# Compact table\n\nKeep the interaction compact.",
    dependencies: { prerequisites: [], requiredBy: [], unresolvedReferences: [], blockers: [], broken: [], blocked: false },
    relatedDocuments: [],
    queue: pipeline,
    sessions: fixture.sessions.filter((session) => session.goal === file),
    attempts: assignment.attempts.map((attempt) => ({ ...attempt, assignmentId: assignment.id })),
    current: { assignmentId: assignment.id, attemptId: "attempt-source", session: "tangent--table" },
    commands: [
      { id: "read", label: "Read", enabled: true },
      { id: "change-agent", label: "Change agent", enabled: true },
      { id: "status", label: "Goal status", enabled: true },
    ],
  };
  const documentRecord = { file, title: goal.title, area: goal.area, text: detail.markdown, comments: [] };
  const { window, document, posts } = await bootWorkTable(fixture, { launchOptions, goalDetail: detail, documentRecord });
  const row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "o");
  await settle(window, 5);

  const readerAction = document.querySelector("[data-reader-goal-actions]");
  readerAction.focus();
  press(window, ":", { shiftKey: true });
  await settle(window);
  const change = document.querySelector("[data-modal-action='change-agent']");
  assert.equal(change.dataset.modalKey, "c");
  change.click();
  await settle(window, 5);
  assert.ok(document.querySelector(".document-reader"), "the Goal stays in its stable Document reader");
  assert.equal(document.querySelector("[data-launch-popover]")?.getAttribute("aria-label"), "Change agent");
  assert.equal(posts.length, 0, "opening the reader action never starts or stops a process");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement.dataset.readerGoalActions, file, "Escape restores the exact reader action opener");
  window.close();
});
