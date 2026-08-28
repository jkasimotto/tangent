// Shift+A shows only the active little brains and their running work
// (Julian, 2026-08-28: "similar to shift F that focusses the focused areas").

import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { withBrainOnlyArea, workTableFixture } from "./work-table-fixture.mjs";

/** Moves the cursor onto one Work row by pointer. */
async function clickRow(window, document, cursor) {
  document.querySelector(`[data-work-cursor='${cursor}']`).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
}

test("A keeps the Areas with a live brain or a running agent and drops the rest; A again shows everything", async () => {
  const { window, document } = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { live: false, planned: true }));
  assert.ok(document.querySelector("[data-work-group='otto/quiet']"), "a quiet Area has a row before A");
  assert.ok(document.querySelector("[data-work-cursor='goal:otto/tangent/goal-stays-online.md']"), "a finished Goal waits on Julian before A");
  const button = document.querySelector("[data-active-only]");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.match(button.textContent, /Active\s*3/, "three Areas run a brain");

  await clickRow(window, document, "goal:otto/quiet/goal-quiet-plan.md");
  press(window, "A", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-group='otto/quiet']"), null, "no brain, no agent: the quiet Area is gone");
  assert.ok(document.querySelector("[data-work-group='otto/tangent']"), "a live brain keeps its Area");
  assert.ok(document.querySelector("[data-work-cursor='goal:otto/tangent/goal-compact-table.md']"), "a Goal with a live agent stays");
  assert.equal(document.querySelector("[data-work-cursor='goal:otto/tangent/goal-stays-online.md']"), null, "a Goal that only waits on Julian is not active");
  assert.equal(document.querySelector("[data-active-only]").getAttribute("aria-pressed"), "true");
  assert.equal(window.localStorage.getItem("agent-shell.active-only"), "true");
  const cursor = document.querySelector("[data-work-cursor].cursor");
  assert.ok(cursor, "the cursor moved off the vanished Area");
  assert.notEqual(cursor.closest("tbody[data-work-group]").dataset.workGroup, "otto/quiet");

  press(window, "Escape");
  await settle(window);
  assert.ok(document.querySelector("[data-work-group='otto/quiet']"), "Escape shows every Area again");
  assert.equal(document.querySelector("[data-active-only]").getAttribute("aria-pressed"), "false");

  document.querySelector("[data-active-only]").click();
  await settle(window);
  assert.equal(document.querySelector("[data-work-group='otto/quiet']"), null, "the toolbar switch is the pointer way");
  press(window, "A", { shiftKey: true });
  await settle(window);
  assert.ok(document.querySelector("[data-work-group='otto/quiet']"), "A again brings every Area back");
});
