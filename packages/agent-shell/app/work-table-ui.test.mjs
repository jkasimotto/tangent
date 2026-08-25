// The Work table's structure, keyboard, focus, and state proofs
// (otto/tangent/design-redesign-work-as-a-compact-table, "Accessibility proof
// contract"). Every test reads the same seven-Goal, three-group fixture, so a
// change to one contract cannot pass by changing the data under it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture, withDirectAsks, plannedWorkFixture } from "./work-table-fixture.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Returns the visible Goal-title buttons of the work table, in row order. */
function titles(document) {
  return [...document.querySelectorAll(".work-table [data-work-row-title]")].filter((button) => !button.closest("tr[hidden]"));
}

test("the work table states its rows and columns in the accessibility tree", async () => {
  const { document } = await bootWorkTable(workTableFixture());
  const table = document.querySelector("table.work-table");
  assert.ok(table, "Work is one semantic table");
  assert.equal(document.querySelectorAll("table.work-table").length, 1, "one table holds every Goal");
  assert.match(table.querySelector("caption").textContent, /Current work/);

  const columns = [...table.querySelectorAll("thead th")];
  assert.deepEqual(columns.map((column) => column.textContent.trim()), ["Select", "Work", "State", "Time", "Action"]);
  assert.ok(columns.every((column) => column.getAttribute("scope") === "col"), "every column header declares its scope");
  assert.equal(table.querySelectorAll("colgroup col").length, columns.length, "one column element per column carries its width");

  const groups = [...table.querySelectorAll("tbody")];
  assert.equal(groups.length, 3, "one row group per brain-owned Area");
  for (const group of groups) {
    const header = group.querySelector("tr.work-group-row > th");
    assert.ok(header.id, "the group header has a stable id");
    assert.equal(group.getAttribute("aria-labelledby"), header.id, "the row group is named by that header");
    assert.equal(header.colSpan, columns.length, "the group header spans every column");
    assert.equal(header.getAttribute("scope"), "colgroup");
    assert.ok([...group.children].every((child) => child.tagName === "TR"), "every row-group child stays a row");
  }

  const row = table.querySelector("tr.work-row");
  const rowHeader = row.querySelector("th[scope='row']");
  assert.ok(rowHeader, "the Goal title is the row header, so every cell carries the Goal's name");
  assert.match(rowHeader.textContent, /Redesign the onboarding walkthrough/);
  assert.equal(row.children.length, columns.length, "a Goal row fills every column");
});

test("every status carries a word, and every icon-only control carries a name", async () => {
  const { document } = await bootWorkTable(withDirectAsks(workTableFixture()));
  for (const state of document.querySelectorAll(".work-table .desk-state")) {
    assert.match(state.textContent.trim(), /\S/, "a status is never colour alone");
  }
  for (const bar of document.querySelectorAll(".work-table .desk-goal-bar")) {
    assert.match(bar.getAttribute("aria-label") ?? "", /\S/, "the time bar has a text equivalent");
  }
  const named = [...document.querySelectorAll(".work-table button, .work-table summary, .ask-table button, .work-table input")];
  for (const control of named) {
    const name = (control.getAttribute("aria-label") ?? control.textContent ?? "").trim();
    assert.match(name, /\S/, `every control is named: ${control.outerHTML.slice(0, 80)}`);
  }
  for (const summary of document.querySelectorAll(".work-table .desk-action-menu > summary")) {
    assert.match(summary.getAttribute("aria-label"), /^Actions for .+/, "an icon-only menu names its Goal");
  }
  assert.equal(document.querySelectorAll(".work-table th:empty").length, 0, "no header cell is empty");
});

test("the direct-ask table keeps questions out of the work table", async () => {
  const { document } = await bootWorkTable(withDirectAsks(workTableFixture()));
  const askTable = document.querySelector("table.ask-table");
  assert.ok(askTable, "For you is its own table");
  assert.deepEqual([...askTable.querySelectorAll("thead th")].map((cell) => cell.textContent.trim()), ["Area", "Kind", "Question", "Action"]);
  const rows = [...askTable.querySelectorAll("tr.ask-row")];
  assert.equal(rows.length, 2, "one row per open Request");
  for (const row of rows) {
    assert.equal(row.querySelector("th[scope='row']").className, "ask-cell-question", "the question is the row header");
    assert.match(row.querySelector(".ask-question").textContent, /\?$/, "every row asks a real question");
  }
  assert.deepEqual(rows.map((row) => row.querySelector(".ask-cell-kind").textContent), ["Test", "Decide"]);
  assert.equal(document.querySelectorAll(".work-table .ask-row").length, 0, "no question repeats inside the work table");
  // A Test question and its Ready-for-validation Goal can both exist; only the
  // Test row answers it.
  const online = document.querySelector("tr[data-goal-anchor$='goal-stays-online.md']");
  assert.match(online.querySelector(".desk-state").textContent, /^Ready for validation$/);
  assert.equal(online.querySelector("[data-verdict], [data-verdict-line]"), null, "the Goal row carries no verdict");
});

test("arrows, Home, End, and Enter move and open without leaving the table", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const rows = titles(document);
  assert.equal(rows.length, 7, "seven Goal rows");
  rows[0].focus();
  press(window, "ArrowDown");
  assert.equal(document.activeElement, rows[1], "Arrow Down moves to the next Goal title");
  press(window, "ArrowUp");
  assert.equal(document.activeElement, rows[0]);
  press(window, "ArrowUp");
  assert.equal(document.activeElement, rows[0], "the first row holds at the top");
  press(window, "End");
  assert.equal(document.activeElement, rows.at(-1), "End reaches the last visible Goal title");
  press(window, "Home");
  assert.equal(document.activeElement, rows[0], "Home returns to the first");
  const moved = press(window, "ArrowDown");
  assert.equal(moved.defaultPrevented, true, "row navigation owns the arrow key");

  rows[0].click();
  await settle(window);
  assert.ok(document.querySelector(".document-reader, .work-page"), "Enter or a click on the title opens the Goal, never an agent");
});

test("Space checks a startable Goal, and Escape clears the selection", async () => {
  const { window, document, posts } = await bootWorkTable(plannedWorkFixture(), { workFilter: "inactive" });
  const startable = [...document.querySelectorAll("tr.work-row")].filter((row) => row.querySelector("[data-check-goal]"));
  assert.equal(startable.length, 3, "only a Startable Goal offers a checkbox");
  const checkbox = startable[0].querySelector("[data-check-goal]");
  checkbox.click();
  await settle(window);
  assert.equal(document.querySelectorAll("tr.work-row.selected").length, 1, "checking selects the row");
  assert.ok(document.querySelector("[data-start-selected]"), "one checked Goal offers one shared agent");
  assert.equal(posts.length, 0, "selection never starts work");

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(window);
  assert.equal(document.querySelectorAll("tr.work-row.selected").length, 0, "Escape clears a multi-Goal selection");
});

test("a poll that changes the facts keeps focus on the same control", async () => {
  const fixture = workTableFixture();
  const { window, document } = await bootWorkTable(fixture);
  const action = document.querySelector("tr[data-goal-anchor$='goal-compact-table.md'] .work-cell-action .desk-action");
  const key = action.dataset.focusKey;
  action.focus();
  assert.equal(document.activeElement, action);

  // The next poll finds the step waiting instead of working: the row stays, its
  // text changes, and the focused control must survive the repaint.
  fixture.sessions.find((session) => session.name === "tangent--table").state = "waiting";
  fixture.pipelines.find((pipeline) => pipeline.goal.endsWith("goal-compact-table.md")).steps[0].state = "waiting";
  await window.refresh();
  await settle(window);

  const after = document.querySelector("tr[data-goal-anchor$='goal-compact-table.md'] .work-cell-action .desk-action");
  assert.notEqual(after, action, "the repaint really replaced the row");
  assert.match(document.querySelector("tr[data-goal-anchor$='goal-compact-table.md'] .desk-state").textContent, /^Waiting$/);
  assert.equal(document.activeElement.dataset.focusKey, key, "focus stays on the same control");
});

test("lifecycle state and dependency readiness stay separate facts", async () => {
  const current = await bootWorkTable(withDirectAsks(workTableFixture()));
  /** The lifecycle word one Goal row prints. */
  const stateOf = (document, slug) => document.querySelector(`tr[data-goal-anchor$='goal-${slug}.md'] .desk-state`).textContent.trim();
  assert.equal(stateOf(current.document, "stays-online"), "Ready for validation", "a finished result Julian must accept");
  assert.equal(stateOf(current.document, "walkthrough"), "Stopped");
  assert.equal(current.document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md'] .work-step").textContent, "3/3");
  assert.equal(current.document.querySelectorAll(".work-table .work-readiness").length, 0, "Current work shows no readiness line");

  const planned = await bootWorkTable(plannedWorkFixture(), { workFilter: "inactive" });
  /** The readiness line one planned Goal row prints. */
  const readinessOf = (slug) => planned.document.querySelector(`tr[data-goal-anchor$='goal-${slug}.md'] .work-readiness`).textContent.trim();
  for (const slug of ["startable", "blocked", "broken", "errored"]) {
    assert.equal(stateOf(planned.document, slug), "Open", `${slug} is Open, never Ready`);
  }
  assert.equal(readinessOf("startable"), "Startable");
  assert.equal(readinessOf("blocked"), "Blocked by 2");
  assert.equal(readinessOf("broken"), "Broken dependency");
  assert.equal(readinessOf("errored"), "Dependency error");

  /** The visible primary action of one Goal row. */
  const startAction = (slug) => planned.document.querySelector(`tr[data-goal-anchor$='goal-${slug}.md'] .work-cell-action .desk-action`).textContent.trim();
  assert.equal(startAction("startable"), "Start agent");
  for (const slug of ["blocked", "broken", "errored"]) {
    assert.equal(startAction(slug), "Open", `${slug} opens its Goal instead of starting an agent`);
    assert.equal(planned.document.querySelector(`tr[data-goal-anchor$='goal-${slug}.md'] [data-check-goal]`), null, `${slug} offers no checkbox`);
  }
});

test("a Subgoal disclosure hides rows without leaving the row group", async () => {
  const fixture = workTableFixture();
  const parent = fixture.goals.find((goal) => goal.slug === "compact-table");
  const child = { ...parent, slug: "compact-table-css", file: "otto/tangent/goal-compact-table-css.md", title: "Write the table CSS", depth: 1, session: null, firstStartAt: null };
  const area = fixture.vault.areas.find((item) => item.path === "otto/tangent");
  area.goals.splice(area.goals.indexOf(parent) + 1, 0, child);
  fixture.vault.map.find((item) => item.path === "otto/tangent").goals = area.goals;

  const { window, document } = await bootWorkTable(fixture);
  const toggle = document.querySelector(`[data-toggle-subgoals='${parent.file}']`);
  assert.ok(toggle, "a parent Goal with Subgoals gets one disclosure");
  const subgoalRow = document.querySelector(`tr[data-subgoal-of='${parent.file}']`);
  assert.equal(subgoalRow.parentElement.tagName, "TBODY", "a Subgoal row stays a row of its group");
  assert.equal(subgoalRow.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  toggle.click();
  await settle(window);
  const hidden = document.querySelector(`tr[data-subgoal-of='${parent.file}']`);
  assert.equal(hidden.hidden, true, "the disclosure hides the following Subgoal rows");
  assert.equal(document.querySelector(`[data-toggle-subgoals='${parent.file}']`).getAttribute("aria-expanded"), "false");
  assert.equal(titles(document).length, 7, "a hidden Subgoal leaves the arrow-key path");
});

test("one agent per group: checking across groups moves the selection and says so", async () => {
  const fixture = plannedWorkFixture();
  const other = { ...fixture.goals[0], area: "otto/standards", slug: "standards-startable", file: "otto/standards/goal-standards-startable.md", title: "Write the standards index", dependsOn: [] };
  fixture.vault.areas.push({ path: "otto/standards", name: "standards", goals: [other], documents: [] });
  fixture.vault.map.push({ path: "otto/standards", name: "standards", goals: [other] });
  fixture.brains.push({ area: "otto/standards", status: "running", live: true, session: "otto-standards--brain", generation: 1, state: "working", forJulian: [], requests: [] });
  fixture.sessions.push({ name: "otto-standards--brain", area: "otto/standards", kind: "brain", state: "working", command: "claude" });

  const { window, document } = await bootWorkTable(fixture, { workFilter: "inactive" });
  /** Checks one Goal's selection box. */
  const check = (file) => document.querySelector(`[data-check-goal='${file}']`).click();
  check("otto/tangent/goal-startable.md");
  await settle(window);
  check("otto/tangent/goal-first-prerequisite.md");
  await settle(window);
  assert.equal(document.querySelectorAll("tr.work-row.selected").length, 2, "two Goals of one group select together");
  assert.match(document.querySelector("[data-start-selected]").textContent, /Start agent on 2 Goals/);

  check(other.file);
  await settle(window);
  assert.deepEqual([...document.querySelectorAll("tr.work-row.selected")].map((row) => row.dataset.goalAnchor), [other.file],
    "a Goal in another group replaces the selection instead of joining it");
  assert.match(document.querySelector("#toast").textContent, /Selection moved to Otto \/ Standards\. 2 Goals in another group cleared\./);
});

// The density contract, read from the stylesheet the browser loads. A rendered
// measurement of the same fixture in Chrome gave 834.4 px of cards against
// 348 px of table rows at 1440 px, and 17 rows across three groups and 18 rows
// in one group inside the 714 px work region
// (otto/tangent/impl-implement-the-compact-work-table). This test pins the two
// heights those numbers come from, so a later style change cannot lose the
// density quietly.
test("the row and group heights meet the measured density targets", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  /** Reads one declared pixel height out of the stylesheet. */
  const heightOf = (selector) => {
    const rule = css.split("\n").find((line) => line.trimStart().startsWith(`${selector} {`));
    assert.ok(rule, `${selector} declares its height`);
    const match = /height:\s*(\d+)px/.exec(rule);
    assert.ok(match, `${selector} declares a pixel height`);
    return Number(match[1]);
  };
  const row = heightOf(".work-row > *");
  const group = heightOf(".work-group-row > .work-group-head");
  assert.equal(row, 36, "a Goal row is 36 px");
  assert.equal(group, 32, "a group header is 32 px");
  assert.ok(7 * row + 3 * group <= 360, `seven Goals in three groups fit in 360 px, not ${7 * row + 3 * group}`);
  assert.ok(Math.floor((714 - 3 * group) / row) >= 17, "17 Goal rows fit across three groups in the 714 px work region");
  assert.ok(Math.floor((714 - group) / row) >= 18, "18 Goal rows fit in one group in the 714 px work region");
});
