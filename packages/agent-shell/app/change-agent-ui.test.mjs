import test from "node:test";
import assert from "node:assert/strict";
// Change agent is a message to the brain (D8): the browser never calls the
// replacement route itself.
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

test("c and the Goal pointer action ask the brain to replace the agent", async () => {
  const { fixture, file } = replacementFixture();
  const { window, document, posts } = await bootWorkTable(fixture, { launchOptions });

  const unavailableRow = document.querySelector("[data-goal-anchor='otto/tangent/goal-voice-dump.md']");
  unavailableRow.querySelector("[data-work-object-actions]").click();
  await settle(window);
  const unavailable = document.querySelector("[data-modal-action='changeAgent']");
  assert.equal(unavailable.getAttribute("aria-disabled"), "true", "a non-current Goal has no agent to replace");
  assert.match(unavailable.textContent, /no current assignment/i);
  press(window, "Escape");
  await settle(window);

  let row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.querySelector("[data-work-object-actions]").click();
  await settle(window);
  const pointerAction = document.querySelector("[data-modal-action='changeAgent']");
  assert.equal(pointerAction.dataset.modalKey, "c", "the pointer path teaches the keyboard shortcut");
  pointerAction.click();
  await settle(window, 5);
  const composer = document.querySelector("#describe-work");
  assert.ok(composer, "the pointer action opens the message to the brain");
  assert.equal(composer.value, `Replace the agent on Redesign Work as a compact table (${file})`);
  assert.equal(document.querySelector("#describe-area")?.value, "otto/tangent");
  assert.equal(document.querySelector("[data-launch-popover]"), null, "no chooser: the brain picks the harness");
  press(window, "Escape");
  await settle(window, 3);

  row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "c");
  await settle(window, 5);
  assert.equal(document.querySelector("#describe-work")?.value, `Replace the agent on Redesign Work as a compact table (${file})`, "c opens the same message");
  assert.equal(posts.filter((entry) => entry.path === "/api/goals/attempts/replace").length, 0, "the browser never calls the replacement route");
  window.close();
});

test("the Goal reader exposes Change agent as the same message to the brain", async () => {
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
  press(window, "?", { shiftKey: true, code: "Slash" });
  await settle(window);
  const change = document.querySelector("[data-modal-action='change-agent']");
  assert.equal(change.dataset.modalKey, "c");
  change.click();
  await settle(window, 5);
  assert.equal(document.querySelector("#describe-work")?.value, `Replace the agent on ${goal.title} (${file})`);
  assert.equal(posts.length, 0, "opening the message never starts or stops a process");
  window.close();
});
