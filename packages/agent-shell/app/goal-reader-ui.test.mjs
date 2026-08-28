import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { plannedWorkFixture } from "./work-table-fixture.mjs";

test("o opens one stable Goal reader with narrative, coordination facts, and server-owned actions", async () => {
  const fixture = plannedWorkFixture();
  const file = "otto/tangent/goal-startable.md";
  const goal = fixture.goals.find((item) => item.file === file);
  const detail = {
    goal: { ...goal, doneWhen: "The keyboard contract is proved." },
    markdown: "# Startable\n\nA durable Goal note.",
    dependencies: {
      prerequisites: [{ file: "otto/tangent/goal-foundation.md", title: "Build the foundation", status: "open" }],
      requiredBy: [], unresolvedReferences: ["otto/tangent/goal-missing.md"], blockers: [], broken: [], blocked: true,
    },
    relatedDocuments: [{ file: "otto/tangent/keyboard-contract.md", title: "Keyboard contract" }],
    queue: { revision: 7, assignments: [{ id: "assignment-1", index: 1, instruction: "Implement the UI", status: "running", launch: { harness: "codex", model: "sol", effort: "high" } }] },
    sessions: [{ name: "tangent-worker" }],
    attempts: [{ id: "attempt-1", session: "tangent-worker", status: "running", current: true, resolvedLaunch: { harness: "codex", model: "sol", effort: "high" } }],
    current: { session: "tangent-worker", assignmentId: "assignment-1", attemptId: "attempt-1" },
    commands: [
      { id: "read", label: "Read", enabled: true },
      { id: "start", label: "Start", enabled: false, reason: "Build the foundation is still open." },
      { id: "status", label: "Goal status", enabled: true },
    ],
  };
  const documentRecord = { file, title: goal.title, area: goal.area, text: "# Startable\n\nA durable Goal note.", comments: [] };
  const { window, document, gets } = await bootWorkTable(fixture, { goalDetail: detail, documentRecord });

  const row = document.querySelector(`[data-goal-anchor='${file}']`);
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "o");
  await settle(window, 5);

  assert.ok(gets.some((url) => new URL(url).pathname === "/api/document" && new URL(url).searchParams.get("file") === file));
  assert.ok(gets.some((url) => new URL(url).pathname === "/api/goals/detail" && new URL(url).searchParams.get("goal") === file));
  const reader = document.querySelector(".document-reader");
  assert.ok(reader, "Goal reading reuses the Document reader");
  assert.match(reader.textContent, /A durable Goal note/);
  assert.match(reader.textContent, /The keyboard contract is proved/);
  assert.match(reader.textContent, /Build the foundation/);
  assert.match(reader.textContent, /goal-missing\.md/);
  assert.match(reader.textContent, /Keyboard contract/);
  assert.match(reader.textContent, /Implement the UI/);
  assert.match(reader.textContent, /tangent-worker/);

  assert.equal(document.querySelector("[data-document-keys]"), null, "a Goal reader has one Keys button, not two");
  document.querySelector("[data-reader-goal-actions]").focus();
  press(window, "?", { shiftKey: true, code: "Slash" });
  await settle(window);
  const unavailable = document.querySelector("[data-modal-action='start']");
  assert.equal(unavailable.getAttribute("aria-disabled"), "true");
  assert.match(unavailable.textContent, /Build the foundation is still open/);
  press(window, "Escape");
  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, file, "Back restores the exact Goal row");

  window.close();
});
