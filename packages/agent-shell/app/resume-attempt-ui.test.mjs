// Resume in the browser (ADR-0042): `r` on a Goal row resumes its latest
// attempt and enters the session the server names; the key is printed in
// the Work key sheet; the Goal reader lists a Resume button per attempt.
import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { plannedWorkFixture, workTableFixture } from "./work-table-fixture.mjs";
import { workCommand, workCommandHelpRows } from "./public/work-commands.js";

const file = "otto/tangent/goal-compact-table.md";
const sourceSession = "tangent--table";

/** A Goal with one live attempt on its queue record. */
function attemptFixture() {
  const fixture = workTableFixture();
  const pipeline = {
    goal: file,
    area: "otto/tangent",
    slug: "compact-table",
    revision: 2,
    status: "running",
    currentAssignmentId: "assignment-current",
    steps: [{
      id: "assignment-current", index: 1, status: "running", live: true, session: sourceSession, instruction: "Build the compact Work table.",
      kind: "implementation", launch: { harness: "claude-otto", model: "opus-5", effort: "high" },
      attempts: [{ id: "attempt-1", session: sourceSession, cwd: "/work/tangent", resolvedLaunch: { ref: { harness: "claude-otto", model: "opus-5", effort: "high" }, command: "claude-otto --model claude-opus-5" }, providerSession: { provider: "claude-otto", id: "conv-1" } }],
    }],
  };
  fixture.pipelines = fixture.pipelines.map((record) => record.goal === file ? pipeline : record);
  return fixture;
}

test("r is a printed Goal verb that resumes the latest attempt and enters its session", async () => {
  const fixture = attemptFixture();
  const { window, document, posts } = await bootWorkTable(fixture, {
    /** The server attaches the live attempt. */
    postHandler: ({ path }) => path === "/api/goals/attempts/resume" ? { status: "live", session: sourceSession, command: null } : { ok: true },
  });
  const command = workCommand("resumeAttempt");
  assert.equal(command.keyDisplay, "r");
  assert.equal(command.scope, "goal");
  assert.ok(workCommandHelpRows().some((row) => row.id === "resumeAttempt" && row.keyDisplay === "r"), "the key sheet prints r");

  const row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "r");
  await settle(window, 6);
  const calls = posts.filter((entry) => entry.path === "/api/goals/attempts/resume");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { goal: file });
  assert.equal(document.querySelector("#session-layer").hidden, false, "the live attempt is entered");
  assert.equal(document.querySelector("#session-layer-terminal").dataset.session, sourceSession);
});

test("r on a Goal without attempts says so and posts nothing", async () => {
  const { window, document, posts } = await bootWorkTable(workTableFixture());
  const row = document.querySelector("[data-goal-anchor='otto/tangent/goal-stays-online.md']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "r");
  await settle(window, 3);
  assert.equal(posts.some((entry) => entry.path === "/api/goals/attempts/resume"), false);
  assert.match(document.querySelector("#toast").textContent, /no attempts to resume/i);
});

test("the Goal actions menu lists Resume agent with its key", async () => {
  const { window, document } = await bootWorkTable(attemptFixture());
  const row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.querySelector("[data-work-object-actions]").click();
  await settle(window);
  const action = document.querySelector("[data-modal-action='resumeAttempt']");
  assert.ok(action, "Resume agent is an object action");
  assert.equal(action.dataset.modalKey, "r");
  assert.notEqual(action.getAttribute("aria-disabled"), "true");
});

test("the Goal reader lists a Resume button per attempt that prints r and posts the exact attempt", async () => {
  const fixture = plannedWorkFixture();
  const readerFile = "otto/tangent/goal-startable.md";
  const goal = fixture.goals.find((item) => item.file === readerFile);
  const detail = {
    goal: { ...goal, doneWhen: "It resumes." },
    markdown: "# Startable\n\nA note.",
    dependencies: { prerequisites: [], requiredBy: [], unresolvedReferences: [], blockers: [], broken: [], blocked: false },
    relatedDocuments: [],
    queue: { revision: 2, assignments: [{ id: "assignment-1", index: 1, instruction: "Build it", status: "complete", launch: { harness: "claude-otto", model: "opus-5", effort: null } }] },
    sessions: [],
    attempts: [
      { id: "attempt-dead", session: "tangent-worker", status: "complete", current: false, resolvedLaunch: { ref: { harness: "claude-otto", model: "opus-5", effort: null }, command: "claude-otto --model claude-opus-5" },
        resume: { live: false, session: "tangent-worker", cwd: "/work/tangent", harness: "claude-otto", conversationId: "conv-dead", command: "claude-otto --model claude-opus-5 --resume conv-dead", contextFill: { usedTokens: 210000, windowTokens: 1000000 } } },
      { id: "attempt-agy", session: "tangent-agy", status: "complete", current: false, resolvedLaunch: { ref: { harness: "agy", model: null, effort: null }, command: "agy" },
        resume: { live: false, session: "tangent-agy", cwd: "/work/tangent", harness: "agy", conversationId: null, command: null, contextFill: null } },
    ],
    current: null,
    commands: [{ id: "read", label: "Read", enabled: true }],
  };
  const documentRecord = { file: readerFile, title: goal.title, area: goal.area, text: "# Startable\n\nA note.", comments: [] };
  const { window, document, posts } = await bootWorkTable(fixture, {
    goalDetail: detail,
    documentRecord,
    /** The server opens a resume session for the dead attempt. */
    postHandler: ({ path }) => path === "/api/goals/attempts/resume" ? { status: "resumed", session: "tangent-worker-resume", command: "claude-otto --model claude-opus-5 --resume conv-dead" } : { ok: true },
  });
  const row = document.querySelector(`[data-goal-anchor='${readerFile}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "o");
  await settle(window, 5);
  const reader = document.querySelector(".document-reader");
  assert.match(reader.textContent, /210k of 1000k/, "the last context fill shows on the attempt");
  assert.match(reader.textContent, /conv-dead/, "the conversation id is printed");
  assert.match(reader.textContent, /No conversation id recorded/, "an attempt without an id says so");
  const button = reader.querySelector("[data-resume-attempt='attempt-dead']");
  assert.ok(button, "the dead attempt has a Resume button");
  assert.equal(button.querySelector("kbd").textContent, "r", "the button prints its key");
  assert.equal(reader.querySelector("[data-resume-attempt='attempt-agy']"), null, "no Resume verb without a resume template");
  button.click();
  await settle(window, 5);
  const calls = posts.filter((entry) => entry.path === "/api/goals/attempts/resume");
  assert.deepEqual(calls.map((entry) => entry.body), [{ goal: readerFile, attemptId: "attempt-dead", conversationId: "conv-dead" }]);
  assert.match(document.querySelector("#toast").textContent, /Resume command typed in tangent-worker-resume/);
  press(window, "r", { code: "KeyR" });
  await settle(window, 5);
  assert.equal(posts.filter((entry) => entry.path === "/api/goals/attempts/resume").length, 2, "the printed r key presses the same Resume button inside the reader");
});
