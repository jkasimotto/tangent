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
import { workTableFixture, withDirectAsks, plannedWorkFixture, withBrainOnlyArea } from "./work-table-fixture.mjs";
import { workCommand, workCommandHelpRows } from "./public/work-commands.js";

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
  assert.match(table.querySelector("caption").textContent, /^Work/);
  assert.equal(document.querySelector("[data-work-filter]"), null, "Work is one projection, not Current and Planned modes");

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
    assert.equal(header.getAttribute("scope"), "rowgroup", "the group header names its own row group, not every column of the table");
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

test("Area pointers, toolbar help, and the command palette share one command registry", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const ids = ["previousArea", "nextArea", "openBrain", "stopBrain", "defaults", "newGoal", "focus", "fold", "questions", "note"];
  const menu = document.querySelector(".work-group-action-menu [role='menu']");
  for (const id of ids) {
    const command = workCommand(id);
    const pointer = menu.querySelector(`[data-work-command='${id}']`);
    assert.ok(pointer, `${id} has a pointer on its Area`);
    assert.equal(pointer.getAttribute("aria-keyshortcuts"), command.ariaKeyshortcuts);
    assert.equal(pointer.querySelector("kbd").textContent, command.keyDisplay);
    assert.match(pointer.title, new RegExp(command.keyDisplay.replace(/[?]/g, "\\?")));
  }
  for (const id of ["commands", "keys"]) {
    const command = workCommand(id);
    const pointer = document.querySelector(`[data-work-command='${id}']`);
    assert.equal(pointer.textContent.trim(), `${command.label} ${command.keyDisplay}`);
    assert.equal(pointer.getAttribute("aria-keyshortcuts"), command.ariaKeyshortcuts);
  }
  const complete = document.querySelector("[data-work-command='complete']");
  assert.match(complete.textContent, /Complete Goal\s*x/);

  document.querySelector("[data-work-commands]").click();
  await settle(window);
  const values = [...document.querySelectorAll("[data-modal-select] option")].map((option) => option.value);
  assert.ok(values.includes("stopBrain"));
  assert.ok(values.includes("defaults"));
  const select = document.querySelector("[data-modal-select]");
  select.value = "stopBrain";
  document.querySelector("[data-modal-confirm]").click();
  await settle(window);
  assert.match(document.querySelector("#modal-title").textContent, /Stop the Onboarding brain/, "palette stop runs the same Area confirmation as its pointer");
  document.querySelector("[data-modal-cancel]").click();

  document.querySelector("[data-work-commands]").click();
  await settle(window);
  document.querySelector("[data-modal-select]").value = "defaults";
  document.querySelector("[data-modal-confirm]").click();
  await settle(window);
  assert.equal(document.querySelector("[data-launch-popover]")?.getAttribute("aria-label"), "Default agents", "palette defaults runs the same Area settings pointer");
});

test("Area stop and defaults keys run the same guarded paths as their pointers", async () => {
  const { window, document, posts } = await bootWorkTable(workTableFixture());
  press(window, "s");
  assert.match(document.querySelector("#modal-title").textContent, /Stop the Onboarding brain/);
  assert.match(document.querySelector("[data-modal-confirm]").textContent, /Stop brain\s*↵/);
  press(window, "Enter");
  await settle(window);
  const stop = posts.find((entry) => entry.path === "/api/brains/stop");
  assert.equal(stop.body.area, "otto/onboarding", "plain Enter confirms the exact keyboard-selected brain");
  assert.ok(stop.body.operationId);

  press(window, "d");
  await settle(window);
  assert.equal(document.querySelector("[data-launch-popover]")?.getAttribute("aria-label"), "Default agents");
});

test("Area keys resolve the visible group from Goal and descendant rows", async () => {
  const fixture = workTableFixture();
  const parent = fixture.goals.find((goal) => goal.area === "otto/onboarding");
  const child = {
    ...parent,
    area: "otto/onboarding/lessons",
    slug: "lesson-copy",
    file: "otto/onboarding/lessons/goal-lesson-copy.md",
    title: "Write the lesson copy",
    session: null,
    firstStartAt: null,
  };
  fixture.goals.push(child);
  fixture.vault.areas.push({ path: child.area, name: "lessons", goals: [child], documents: [] });
  fixture.vault.map.push({ path: child.area, name: "lessons", goals: [child] });

  const { window, document } = await bootWorkTable(fixture);
  const childRow = document.querySelector(`[data-goal-anchor='${child.file}']`);
  assert.equal(childRow.closest("[data-work-group]").dataset.workGroup, "otto/onboarding", "the parent brain header owns the descendant Goal");
  childRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);

  press(window, "d");
  await settle(window);
  assert.match(document.querySelector("[data-launch-popover] header").textContent, /Otto \/ Onboarding/, "d opens the owning header's defaults");
  document.querySelector("[data-launch-close]").click();
  press(window, "a");
  await settle(window);
  assert.equal(document.querySelector("#new-goal-area").value, "otto/onboarding", "a creates through the same owning Area header");
});

test("Shift-brackets and their pointer actions jump between real Area headers", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const onboarding = "area:otto/onboarding";
  const standards = "area:otto/standards";
  const tangent = "area:otto/tangent";

  press(window, "}", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, standards, "Shift-] moves from an Area row to the next Area");
  assert.equal(document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor, standards, "the destination Area is focused and visible");

  const tangentGoal = document.querySelector("[data-goal-anchor='otto/tangent/goal-compact-table.md']");
  tangentGoal.querySelector(".work-row-agent").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "{", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, standards, "Shift-[ resolves an agent through its descendant Goal row");

  document.querySelector("[data-goal-anchor='otto/tangent/goal-compact-table.md'] .work-row-step").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "{", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, standards, "Shift-[ resolves step metadata through its descendant Goal row");

  document.querySelector(`[data-work-group='otto/standards'] [data-move-work-area='-1']`).click();
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, onboarding, "the visible previous action runs the same jump");

  document.querySelector("[data-work-commands]").click();
  await settle(window);
  document.querySelector("[data-modal-select]").value = "nextArea";
  document.querySelector("[data-modal-confirm]").click();
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, standards, "the command palette runs the same next-Area action");

  document.querySelector(`[data-work-group='otto/tangent'] [data-move-work-area='1']`).click();
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, tangent, "the final Area holds at the boundary");
});

test("Area jumps skip the synthetic Other Areas group", async () => {
  const { window, document } = await bootWorkTable(workTableFixture(), { areaFocus: ["otto/onboarding"] });
  document.querySelector("[data-fold-work-area='__other-areas']").click();
  await settle(window);
  const outsideGoal = document.querySelector("[data-goal-anchor='otto/standards/goal-framework-docs.md']");
  outsideGoal.querySelector(".work-row-agent").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);

  press(window, "{", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, "area:otto/onboarding", "previous finds the nearest real Area instead of the synthetic group");
  press(window, "}", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, "area:otto/onboarding", "next never enters Other Areas");
});

test("Area keys refuse a Goal in Other Areas because it has no matching pointer header", async () => {
  const fixture = workTableFixture();
  const { window, document } = await bootWorkTable(fixture, { areaFocus: ["otto/onboarding"] });
  document.querySelector("[data-fold-work-area='__other-areas']").click();
  await settle(window);
  const row = document.querySelector("[data-goal-anchor='otto/standards/goal-framework-docs.md']");
  assert.equal(row.closest("[data-work-group]").dataset.workGroup, "__other-areas");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "d");
  assert.equal(document.querySelector("[data-launch-popover]"), null);
  assert.match(document.querySelector("#toast").textContent, /no Area command header/);
});

test("Work carries no attention queue and infers no ask", async () => {
  const { document } = await bootWorkTable(withDirectAsks(workTableFixture()));
  // The For you strip and its Dock badge are gone. A brain's Question is a
  // quiet count on its Area header, and nothing else on Work asks anything.
  assert.equal(document.querySelector("table.ask-table"), null, "no attention queue survives on Work");
  assert.equal(document.querySelector(".attention-queue"), null, "no attention section survives on Work");
  assert.equal(document.querySelector("[data-enable-dock-badge]"), null, "no Dock badge control survives");
  assert.equal(document.querySelectorAll(".ask-row").length, 0, "no ask row exists anywhere on Work");
  assert.equal(document.querySelector("[data-dismiss-ask]"), null, "nothing on Work needs dismissing");

  // A finished Goal is a state, not a question: it makes no row that asks.
  const online = document.querySelector("tr[data-goal-anchor$='goal-stays-online.md']");
  assert.match(online.querySelector(".desk-state").textContent, /^Ready for validation$/);
  assert.equal(online.querySelector("[data-verdict], [data-verdict-line]"), null, "the Goal row carries no verdict");

  // The one count Work shows comes from an explicit brain Request, and it
  // opens the deliberate review rather than answering in place.
  const counts = [...document.querySelectorAll(".desk-state[data-review-questions]")];
  assert.ok(counts.length, "an Area whose brain asked shows a quiet question count");
  assert.match(counts[0].textContent, /^\d+ questions?$/);
});

test("a filter keeps focus in its input and says how many Goals are left", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  assert.equal(titles(document).length, 7);
  const search = document.querySelector("#work-search");
  search.focus();
  search.value = "walkthrough";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);

  assert.equal(document.activeElement.id, "work-search", "a filter that removes the focused row keeps focus in the filter");
  assert.deepEqual(titles(document).map((button) => button.textContent), ["Redesign the onboarding walkthrough"]);
  const region = document.querySelector("#filter-count");
  assert.equal(region.getAttribute("aria-live"), "polite", "the count lives in a polite region");
  assert.equal(region.textContent, "1 Goal", "the region states the result count");

  // The repaint replaced the input, so the second keystroke goes to the new one.
  const refreshed = document.querySelector("#work-search");
  refreshed.value = "zzzznothing";
  refreshed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  assert.equal(titles(document).length, 0);
  assert.match(document.querySelector("#filter-count").textContent, /No work matches/, "an empty result says so");
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

test("the Goal title is the primary session, launch, or context route", async () => {
  const live = await bootWorkTable(workTableFixture());
  const running = live.document.querySelector("tr[data-goal-anchor$='goal-framework-docs.md']");
  assert.ok(running.querySelector("[data-work-row-title][data-open-goal-run]"), "a live Goal title opens its agent session");
  assert.match(running.querySelector(".work-row-agent").textContent, /Claude/, "the agent sits below the Goal title");

  const stopped = live.document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md']");
  assert.ok(stopped.querySelector("[data-work-row-title][data-open-close]"), "a Goal without an openable run opens its durable context");
  assert.match(stopped.querySelector(".work-row-step").textContent, /Step 3 of 3 · codex/, "small step metadata sits below the agent line");

  const planned = await bootWorkTable(plannedWorkFixture());
  assert.ok(planned.document.querySelector("tr[data-goal-anchor$='goal-startable.md'] [data-work-row-title][data-launch-for]"), "a startable Goal title opens the common launch composer");
});

test("vim keys move the persistent Work cursor through brains and Goals and stay inert in the filter", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const goals = [...document.querySelectorAll("tr.work-row:not(.definition)")].filter((row) => !row.hidden);
  assert.equal(document.querySelectorAll("[data-work-cursor].cursor").length, 1);
  press(window, "j");
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, goals[0].dataset.workCursor, "j moves from the Area brain row to its first Goal");
  assert.equal(document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor, goals[0].dataset.workCursor, "cursor motion focuses the row so the browser keeps it visible");
  press(window, "k");
  await settle(window);
  assert.match(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor ?? "", /^area:/, "k moves back onto the Area brain row");
  press(window, "G");
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, goals.at(-1).dataset.workCursor);
  const filter = document.querySelector("#work-search");
  filter.focus();
  press(window, "j");
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, goals.at(-1).dataset.workCursor, "a bare key in the filter does not move the cursor");
});

test("Command-J opens and closes the one session layer without destroying Work", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const row = document.querySelector("[data-work-cursor='goal:otto/standards/goal-framework-docs.md']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "j", { metaKey: true });
  await settle(window);
  assert.equal(document.querySelector("#session-layer").hidden, false);
  assert.ok(document.querySelector("table.work-table"), "Work remains mounted below the session");
  assert.equal(document.querySelector("#session-layer-terminal").dataset.session, "standards--docs");
  assert.equal(document.querySelector("#session-layer-title strong").textContent, "Land standards framework docs", "the Goal names the session");
  assert.match(document.querySelector("#session-layer-title span").textContent, /Claude/, "the agent sits below its Goal in the session header");
  press(window, "j", { metaKey: true });
  await settle(window);
  assert.equal(document.querySelector("#session-layer").hidden, true);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, row.dataset.workCursor);
});

test("an Area brain row takes the cursor and Command-J enters its brain", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const row = document.querySelector("[data-work-cursor='area:otto/tangent']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  assert.ok(document.querySelector("[data-work-cursor='area:otto/tangent']").classList.contains("cursor"), "the visible cursor sits on the Area brain row");
  press(window, "j", { metaKey: true });
  await settle(window);
  assert.equal(document.querySelector("#session-layer-terminal").dataset.session, "otto-tangent--brain");
  assert.equal(document.querySelector("#session-layer-title strong").textContent, "Otto / Tangent");
  assert.match(document.querySelector("#session-layer-title span").textContent, /Claude · Area brain/);
});

test("Work keys expose their help and stay inert in text and terminal input", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const initial = document.querySelector("[data-work-cursor].cursor").dataset.workCursor;
  press(window, "/");
  assert.equal(document.activeElement.id, "work-search", "slash focuses the Work filter");
  for (const key of ["j", "k", "g", "G", "b", "?"]) press(window, key);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, initial, "bare Work keys do nothing in the filter");
  document.activeElement.blur();
  press(window, "?");
  assert.equal(document.querySelector("#modal-title").textContent, "Move around Work");
  const helpRows = [...document.querySelectorAll("#modal-copy .key-sheet > div")];
  assert.equal(helpRows.length, workCommandHelpRows().length, "each registered command gets its own readable row");
  assert.equal(helpRows.find((row) => row.querySelector("kbd")?.textContent === "s")?.querySelector("strong")?.textContent, "Stop brain");
  assert.equal(helpRows.find((row) => row.querySelector("kbd")?.textContent === "d")?.querySelector("strong")?.textContent, "Defaults");
  const scroller = document.querySelector("#modal-copy");
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 200 });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 900 });
  press(window, "j");
  assert.equal(scroller.scrollTop, 34, "j scrolls the complete key sheet by one compact row");
  press(window, "d", { ctrlKey: true });
  assert.equal(scroller.scrollTop, 134, "Ctrl-D scrolls the key sheet by half a page");
  press(window, "G");
  assert.equal(scroller.scrollTop, 700, "G reaches the last command");
  press(window, "g");
  press(window, "g");
  assert.equal(scroller.scrollTop, 0, "gg returns to the first command");
  document.querySelector("[data-modal-confirm]").click();

  const live = document.querySelector("[data-work-cursor='goal:otto/standards/goal-framework-docs.md']");
  live.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "j", { metaKey: true });
  await settle(window);
  const terminalInput = document.querySelector("#session-layer-terminal");
  terminalInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }));
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, live.dataset.workCursor, "bare keys in the terminal do not move Work");
});

test("Command-J refuses a row with no live session and an outside click closes a live one", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const stopped = document.querySelector("[data-work-cursor='goal:otto/onboarding/goal-walkthrough.md']");
  stopped.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "j", { metaKey: true });
  assert.equal(document.querySelector("#session-layer").hidden, true, "enter never starts a missing session");
  assert.match(document.querySelector("#toast").textContent, /no live session to enter/i);

  const live = document.querySelector("[data-work-cursor='goal:otto/standards/goal-framework-docs.md']");
  live.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "j", { metaKey: true });
  await settle(window);
  document.querySelector("#session-layer").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(document.querySelector("#session-layer").hidden, true);
  assert.ok(document.querySelector("table.work-table"), "outside close leaves Work mounted");
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
  assert.match(current.document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md'] .work-row-step").textContent, /Step 3 of 3 · codex/);
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
  fixture.brains.push({ area: "otto/standards", status: "active", live: true, session: "otto-standards--brain", generation: 1, state: "working", forJulian: [], requests: [] });
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
test("the row height makes room for Goal, agent, and step hierarchy", async () => {
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
  assert.equal(row, 48, "a Goal row has three compact metadata lines");
  assert.equal(group, 32, "a group header is 32 px");
  assert.ok(Math.floor((714 - 3 * group) / row) >= 12, "12 three-line Goal rows fit across three groups in the 714 px work region");
  assert.ok(Math.floor((714 - group) / row) >= 14, "14 three-line Goal rows fit in one group in the 714 px work region");
});

test("the session overlay gives xterm definite full-track dimensions", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  const rule = css.split("\n").find((line) => line.trimStart().startsWith(".session-layer-terminal {") && line.includes("box-sizing"));
  assert.ok(rule, "the session terminal has an overlay-specific rule");
  assert.match(rule, /box-sizing:\s*border-box/, "padding stays inside the grid track");
  assert.match(rule, /width:\s*100%/, "the xterm host has a definite width");
  assert.match(rule, /height:\s*100%/, "the xterm host has a definite height");
  assert.doesNotMatch(rule, /width:\s*auto|height:\s*auto/, "the xterm host does not depend on intrinsic size");
});

// Julian's word 2026-08-26: every row's TIME bar must start at the same x. The
// bar can only do that if the label before it sits in a box of its own width
// instead of sharing the cell's flow, so this test pins the three numbers that
// hold the column together: the label's width, the gap, and the bar's width
// must fill the column's content box exactly.
test("the Time column's label has a fixed width, so every bar starts at the same x", async () => {
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  /** Reads one declared pixel length off the rule that starts with `selector`. */
  const pixelsOf = (selector, property) => {
    const rule = css.split("\n").find((line) => line.trimStart().startsWith(`${selector} {`));
    assert.ok(rule, `${selector} has a rule`);
    const match = new RegExp(`${property}:\\s*(\\d+)px`).exec(rule);
    assert.ok(match, `${selector} declares a pixel ${property}`);
    return Number(match[1]);
  };
  const column = pixelsOf(".work-col-time", "width");
  const label = pixelsOf(".work-cell-time .desk-goal-elapsed", "width");
  const bar = pixelsOf(".work-cell-time .desk-goal-bar", "width");
  const gap = pixelsOf(".work-cell-time .desk-goal-bar", "margin-left");
  const cellPadding = 2 * 10;
  assert.ok(label >= 52, `the label box holds the longest label durationLabel prints, not ${label}px`);
  assert.equal(label + gap + bar, column - cellPadding, "label, gap and bar fill the Time column's content box");
  // The label is a <span>. Width does nothing to an inline box, so the display
  // that makes the 54px real is as load-bearing as the number itself.
  assert.match(
    css.split("\n").find((line) => line.trimStart().startsWith(".work-cell-time .desk-goal-elapsed {")),
    /display:\s*inline-block/,
    "the label box declares a display that honours its width",
  );
});

// Julian's word 2026-08-26: "any active brains should show in the work screen
// even if they dont have agents." A live brain earns its Area one group header
// and no row, and the header says which brain state it is
// (otto/tangent/design-active-brains-show-on-work-even-with-no-agents).

/** Returns the group header of one Area path, or null. */
function groupHeader(document, area) {
  return document.querySelector(`tbody.work-group[data-work-group='${area}'] tr.work-group-row > th`);
}

test("an Area whose brain is live keeps its group with no Goal row under it", async () => {
  const { document } = await bootWorkTable(withBrainOnlyArea(workTableFixture()));
  const group = document.querySelector("tbody.work-group[data-work-group='otto/quiet']");
  assert.ok(group, "the live brain earns its Area a group");
  assert.equal(group.querySelectorAll("tr.work-row").length, 0, "a brain-only group renders no data row");
  assert.equal(group.querySelectorAll("tr").length, 1, "the header line is the whole group");
  assert.equal(document.querySelectorAll("table.work-table tbody").length, 4, "the brain-only group joins the three Goal-bearing groups, it does not replace one");
});

test("the brain-only group header states the brain's state and opens that brain", async () => {
  const working = await bootWorkTable(withBrainOnlyArea(workTableFixture()));
  const header = groupHeader(working.document, "otto/quiet");
  assert.match(header.querySelector(".desk-state").textContent, /^Brain working$/);
  assert.equal(header.querySelector(".desk-state").className, "desk-state working", "a working brain takes the working colour");
  const button = header.querySelector(".work-group-brain");
  assert.match(button.textContent, /Open brain/);
  assert.equal(button.dataset.openBrain, "otto-quiet--brain", "the button carries the live brain session");

  const waiting = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { state: "waiting" }));
  const pill = groupHeader(waiting.document, "otto/quiet").querySelector(".desk-state");
  assert.match(pill.textContent, /^Brain waiting for you$/);
  assert.equal(pill.className, "desk-state waiting", "a waiting brain takes the waiting colour");
});

test("a stopped brain earns no empty group, while one live brain always remains visible", async () => {
  const stopped = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { live: false }));
  assert.equal(stopped.document.querySelector("tbody.work-group[data-work-group='otto/quiet']"), null,
    "only a running, live brain puts its Area on Work");

  const withLive = await bootWorkTable(withBrainOnlyArea(plannedWorkFixture(), {}));
  assert.ok(withLive.document.querySelector("tbody.work-group[data-work-group='otto/quiet']"),
    "the one Work projection never hides a live brain");
});

test("working agents and open Questions still outrank the brain word", async () => {
  const { document } = await bootWorkTable(withDirectAsks(withBrainOnlyArea(workTableFixture())));
  assert.match(groupHeader(document, "otto/standards").querySelector(".desk-state").textContent, /^2 working$/,
    "an Area whose agents work reports the agents, not its brain");
  const asked = groupHeader(document, "otto/tangent").querySelector(".desk-state");
  assert.match(asked.textContent, /^\d+ questions?$/, "an Area whose brain asked reports the Questions first");
  assert.equal(asked.dataset.reviewQuestions, "otto/tangent", "the count opens the deliberate review");
});

test("an Area Focus that excludes the brain's Area hides its group", async () => {
  const { document } = await bootWorkTable(withBrainOnlyArea(workTableFixture()), { areaFocus: ["otto/standards"] });
  assert.equal(document.querySelector("tbody.work-group[data-work-group='otto/quiet']"), null,
    "a live brain outside the Focus stays hidden");
  assert.ok(document.querySelector("tbody.work-group[data-work-group='otto/standards']"), "the focused Area stays");
});

test("an Area shows its unstarted Goals and live brain together", async () => {
  const { document } = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { planned: true }));
  const group = document.querySelector("tbody.work-group[data-work-group='otto/quiet']");
  assert.ok(group, "the Area is visible");
  assert.equal(group.querySelectorAll("tr.work-row").length, 1, "the one projection includes the unstarted Goal");
  const header = groupHeader(document, "otto/quiet");
  assert.match(header.querySelector(".desk-state").textContent, /^Brain working$/);
  assert.match(header.querySelector(".work-group-count").textContent, /^1 open$/,
    "the summary and rows use the same projection");

  const stopped = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { planned: true, live: false }));
  assert.equal(stopped.document.querySelector("tbody.work-group[data-work-group='otto/quiet']").querySelectorAll("tr.work-row").length, 1,
    "stopping the brain never hides the Area's Goal");
});

test("a retired stored filter cannot hide an unstarted Goal", async () => {
  const { document } = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { planned: true }), { workFilter: "active" });
  assert.equal(document.querySelector("[data-work-filter]"), null);
  assert.ok(document.querySelector("[data-goal-anchor='otto/quiet/goal-quiet-plan.md']"));
});
