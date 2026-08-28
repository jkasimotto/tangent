// Work's fold triangle, cursor marks, and printed keys
// (docs/design/work-view-affordances/design-record.md D1 to D6). One fold
// glyph, no cursor caret, every verb button prints its key, and the caption
// and the `?` sheet read one key table.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture, withDirectAsks } from "./work-table-fixture.mjs";
import { workCaptionKeys, workCommand, workCommandHelpRows, workRowKind } from "./public/work-commands.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Adds one Subgoal under the compact-table Goal so a row has something to fold. */
function withSubgoal(fixture) {
  const parent = fixture.goals.find((goal) => goal.slug === "compact-table");
  const child = { ...parent, slug: "compact-table-css", file: "otto/tangent/goal-compact-table-css.md", title: "Write the table CSS", depth: 1, session: null, firstStartAt: null };
  const area = fixture.vault.areas.find((item) => item.path === "otto/tangent");
  area.goals.splice(area.goals.indexOf(parent) + 1, 0, child);
  fixture.vault.map.find((item) => item.path === "otto/tangent").goals = area.goals;
  return { fixture, parent, child };
}

/** The caption's key line as `key word` pairs. */
function captionKeys(document) {
  const hint = document.querySelector(".work-caption .work-keyboard-hint");
  return [...hint.querySelectorAll("kbd")].map((kbd) => kbd.textContent);
}

test("one rotating triangle folds Areas and Goals with Subgoals; the pill is gone", async () => {
  const { fixture, parent, child } = withSubgoal(workTableFixture());
  const { window, document } = await bootWorkTable(fixture);
  assert.equal(document.querySelector(".work-tree-toggle, .work-subgoal-toggle"), null, "no `+`/`−` pill remains");
  const areaFold = document.querySelector("[data-work-group='otto/onboarding'] .work-group-row .work-fold");
  assert.ok(areaFold, "an Area header has its triangle");
  assert.equal(areaFold.textContent, "▾", "an open Area points down");
  assert.equal(areaFold.parentElement.firstElementChild, areaFold, "the triangle sits at the far left of the name");
  assert.equal(areaFold.querySelector("kbd"), null, "the triangle prints no key of its own");
  const name = areaFold.nextElementSibling;
  assert.ok(name.matches("[data-work-cursor-control][data-open-area-brain], [data-work-cursor-control][data-open-brain]"), "the name button keeps the brain route");

  areaFold.click();
  await settle(window);
  const folded = document.querySelector("[data-work-group='otto/onboarding'] .work-group-row .work-fold");
  assert.ok(document.querySelector("[data-work-group='otto/onboarding']").classList.contains("folded"), "a click on the triangle folds the Area");
  assert.equal(folded.textContent, "▸", "a folded Area points right");
  assert.equal(folded.getAttribute("aria-expanded"), "false");
  assert.match(document.querySelector("[data-work-group='otto/onboarding'] .work-group-count").textContent, /\d+ open/, "the count stays on a folded header");

  const goalFold = document.querySelector(`.work-fold[data-work-tree-goal='${parent.file}']`);
  assert.equal(goalFold.textContent, "▾", "a Goal with Subgoals has the same triangle");
  assert.equal(document.querySelector(`tr[data-goal-anchor='${parent.file}'] .work-subgoal-count`), null, "open, the Subgoal rows are the count");
  goalFold.click();
  await settle(window);
  assert.equal(document.querySelector(`tr[data-subgoal-of='${parent.file}']`).hidden, true);
  assert.equal(document.querySelector(`tr[data-goal-anchor='${parent.file}'] .work-subgoal-count`).textContent, "1 Subgoal", "a folded Goal says what it hides");
  for (const row of document.querySelectorAll("tr.work-row")) {
    assert.ok(row.querySelector(".work-cell-title > .work-fold, .work-cell-title > .work-fold-space"), "every Goal row starts with a triangle or its space, so titles align");
  }
});

test("the cursor keeps its bar and tint and loses its triangle", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  assert.doesNotMatch(css, /\.cursor[^{]*::before[^}]*▸/, "no caret marks the cursor row");
  assert.match(css, /\.work-row\.cursor > :first-child[^}]*inset 3px 0 0 var\(--blue\)/, "the bar stays");
  assert.equal(css.match(/\.work-tree-toggle|\.work-subgoal-toggle/g), null, "the pill styles are gone");
  const kbdRules = css.split("\n").filter((line) => /^\.(work-|desk-|key-sheet|modal-action-list|primary-button)[^{]*kbd[^{]*\{/.test(line));
  const fonts = kbdRules.filter((line) => /font:|font-size/.test(line));
  assert.equal(fonts.length, 1, `one printed-key style in Work, found: ${fonts.join("\n")}`);
  assert.match(fonts[0], /font-size: 11px/);
});

test("every verb button in Work prints its key in one kbd", async () => {
  const { document } = await bootWorkTable(withDirectAsks(workTableFixture()));
  const buttons = [...document.querySelectorAll(".work-table button.desk-action:not([data-launch-for]), .work-table .desk-launch-ref, .work-table .work-group-brain, .work-table .desk-action-menu-trigger, .work-table [data-review-questions], .work-page .primary-button")];
  assert.ok(buttons.length >= 5, "the fixture renders verb buttons");
  for (const button of buttons) {
    const kbd = button.querySelector("kbd");
    assert.ok(kbd, `${button.className} prints its key: ${button.outerHTML.slice(0, 120)}`);
    assert.equal(button.lastElementChild, kbd, "the key sits right of the verb");
  }
  const open = document.querySelector(".work-table button.desk-action[data-open-close], .work-table button.desk-action[data-open-goal-run]");
  assert.equal(open.querySelector("kbd").textContent, "↵", "Open prints Enter");
  assert.equal(document.querySelector(".work-table .work-group-brain kbd").textContent, "b");
  assert.equal(document.querySelector(".work-table .desk-action-menu-trigger kbd").textContent, "?");
  assert.equal(document.querySelector(".work-table [data-review-questions] kbd").textContent, "r");
  assert.equal(workCommand("open")?.keyDisplay, "↵", "Enter is a registered Work command");
});

test("Enter on a row is the registered open command and a focused button keeps its own press", async () => {
  const { window, document, gets } = await bootWorkTable(workTableFixture());
  const row = document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  document.activeElement?.blur?.();
  const before = gets.length;
  const event = press(window, "Enter");
  assert.equal(event.defaultPrevented, true, "Enter is owned by Work");
  await settle(window);
  assert.ok(gets.slice(before).some((url) => url.includes("goal-walkthrough")), "Enter opens the row's route");

  const menu = document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md'] .desk-action-menu-trigger");
  menu.focus();
  assert.equal(document.activeElement, menu);
  const native = press(window, "Enter");
  assert.equal(native.defaultPrevented, false, "a focused button keeps its native Enter");
});

test("the caption prints the current row's keys from the same table as the ? sheet", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const areaRow = document.querySelector("[data-work-group='otto/onboarding'] .work-group-row");
  areaRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  assert.equal(document.querySelector(".work-keyboard-hint").dataset.workCaptionRow, "area");
  const areaKeys = captionKeys(document);
  for (const key of ["h/l", "b", "a", "?"]) assert.ok(areaKeys.includes(key), `an Area row teaches ${key}: ${areaKeys.join(" ")}`);
  assert.equal(areaKeys.includes(":"), false, "there is no separate command menu");
  assert.match(document.querySelector(".work-keyboard-hint").textContent, /h\/l fold/, "the triangle's keys are printed beside the word fold");

  press(window, "j");
  await settle(window);
  assert.equal(document.querySelector(".work-keyboard-hint").dataset.workCaptionRow, "goal");
  const goalKeys = captionKeys(document);
  for (const key of ["↵", "o", "x", "?"]) assert.ok(goalKeys.includes(key), `a Goal row teaches ${key}: ${goalKeys.join(" ")}`);

  const sheet = new Map(workCommandHelpRows().map((row) => [row.id, row.keyDisplay]));
  for (const kind of ["area", "goal", "definition", "none"]) {
    for (const entry of workCaptionKeys(kind)) {
      for (const id of entry.ids) assert.ok(sheet.has(id), `${kind} caption entry ${id} is a registered command`);
      assert.equal(entry.keyDisplay, entry.ids.map((id) => sheet.get(id)).join(entry.join), "the caption prints the sheet's key");
    }
  }
  assert.equal(workRowKind("area:otto/onboarding"), "area");
  assert.equal(workRowKind("goal:otto/x.md"), "goal");
  assert.equal(workRowKind(""), "none");

  press(window, "?");
  await settle(window);
  const rows = [...document.querySelectorAll("[data-modal-action]")];
  assert.ok(rows.some((row) => row.dataset.modalKey === "↵" && row.querySelector("strong")?.textContent === "Open"), "the ? sheet lists Enter as Open");
});
