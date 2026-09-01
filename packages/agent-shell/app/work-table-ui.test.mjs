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
import { workCommand } from "./public/work-commands.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A button's words without the key it prints, so a proof reads the verb alone. */
function verb(element) {
  return [...element.childNodes].filter((node) => node.nodeName !== "KBD").map((node) => node.textContent).join("").trim();
}

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
  assert.deepEqual(columns.map((column) => column.textContent.trim()), ["Goal", "Agent", "Status", "Controls"], "three printed columns and one hidden-label controls column (work-screen-refresh D8)");
  assert.ok(columns[3].querySelector(".visually-hidden"), "the controls column prints no header");
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

test("Area Map controls and m open the broad root map, then drill and return without losing the Work row", async () => {
  const fixture = workTableFixture();
  const rootGoal = { ...fixture.goals[0], area: "otto", file: "otto/goal-root.md", slug: "root", title: "Root work" };
  fixture.goals = [rootGoal, ...fixture.goals];
  fixture.vault.areas = [
    { path: "otto", name: "otto", goals: [rootGoal], documents: [] },
    ...fixture.vault.areas,
  ];
  fixture.vault.map = [
    { path: "otto", name: "otto", goals: [rootGoal] },
    ...fixture.vault.map,
  ];
  /** Serves an empty canvas for the Area named by the browser request. */
  const areaCanvas = (url) => ({
    area: url.searchParams.get("area"), file: `${url.searchParams.get("area")}/map.canvas`,
    exists: false, hash: null, canvas: { nodes: [], edges: [] }, warnings: [], proposals: [], view: null,
  });
  const { window, document, gets } = await bootWorkTable(fixture, { areaCanvas });

  const rootMap = document.querySelector('[data-work-cursor="area:otto"] [data-open-area-map="otto"]');
  assert.ok(rootMap, "the top-level Area has its visible Map control");
  rootMap.click();
  await settle(window);
  assert.match(document.querySelector("#bar-context").textContent, /ottoMap/);
  assert.ok(gets.some((url) => new URL(url).pathname === "/api/areas/map-world" && new URL(url).searchParams.get("located") === "otto"), "the opened screen requests the unified world at the selected Area");

  document.querySelector("#back-button").click();
  await settle(window);
  assert.equal(document.activeElement, document.querySelector('[data-work-cursor="area:otto"] [data-open-area-map]'), "Back restores focus to the opening Map control");

  const childRow = document.querySelector('[data-work-cursor="area:otto/tangent"]');
  assert.ok(childRow, "the child Area is a normal Work cursor row");
  childRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  childRow.querySelector("[data-work-cursor-control]").focus();
  press(window, "m");
  await settle(window);
  assert.match(document.querySelector("#bar-context").textContent, /otto \/ tangentMap/);
  assert.equal(new URL(gets.at(-1)).searchParams.get("located"), "otto/tangent", "m requests the unified world at the selected child");
  assert.match(document.querySelector(".map-focus-controls").textContent, /Starred.*Active/, "the map prints the shared Focus switches");
  assert.equal(document.querySelector(".map-screen > header"), null, "the map uses the primary shell header");
  assert.match(document.querySelector("#back-button").textContent, /^Work esc$/i);

  const requestsBeforeDrill = gets.length;
  document.querySelector('[data-map-breadcrumb="otto/tangent"]').click();
  await settle(window);
  assert.equal(gets.length, requestsBeforeDrill, "a breadcrumb fits inside the authoritative world without loading another shard root");

  press(window, "Escape");
  await settle(window);
  assert.equal(document.activeElement, document.querySelector('[data-work-cursor="area:otto/tangent"] [data-open-area-map]'), "one Escape restores focus to the child row's Map control");
});

test("presented Documents are capped child rows whose visible dismiss control uses Julian's fenced route", async () => {
  const fixture = workTableFixture();
  const goal = fixture.goals[0];
  goal.presentations = [1, 2, 3, 4].map((number) => ({
    file: `otto/onboarding/design-${number}.md`, root: "vault", title: `Readable design ${number}`,
    presentedBy: { session: "worker-a" }, presentedAt: `2026-08-28T00:00:0${number}.000Z`, note: "Read this result",
  }));
  const { window, document, posts } = await bootWorkTable(fixture);
  const rows = [...document.querySelectorAll("[data-presentation-goal]")];
  assert.equal(rows.length, 3, "Work renders no more than three presentations");
  assert.match(rows[0].textContent, /Readable design 1/);
  assert.match(document.querySelector("[data-work-cursor^='document-more:']").textContent, /and 1 more/);
  rows[0].querySelector("[data-withdraw-presentation]").click();
  await settle(window);
  assert.equal(posts.at(-1).path, "/api/goals/dismiss-presentation");
  assert.deepEqual(posts.at(-1).body, {
    goal: "otto/onboarding/goal-walkthrough.md",
    file: "otto/onboarding/design-1.md",
    operationId: posts.at(-1).body.operationId,
  }, "the pointer dismisses only its own Goal presentation");
  assert.match(posts.at(-1).body.operationId, /^[0-9a-f-]{36}$/);
});

test("brain cards share the child-row cap, expose accessible actions, copy, open, and dismiss without Goal mutation", async () => {
  const fixture = workTableFixture();
  const goal = fixture.goals[0];
  goal.presentations = [{ file: "otto/onboarding/design.md", root: "vault", title: "Design", presentedBy: { session: "worker-a" }, presentedAt: "2026-08-28T00:00:00.000Z" }];
  goal.cards = [
    { id: "copy-1", kind: "copy", title: "Review request", fields: { text: "Please review" }, fieldsHash: "a", summary: "Please review", presentedBy: { session: "brain-a" }, presenterLive: true },
    { id: "link-1", kind: "link", title: "Preview", fields: { label: "Preview", url: { href: "https://example.com/", host: "example.com" } }, fieldsHash: "b", summary: "example.com", presentedBy: { session: "brain-a" }, presenterLive: true },
    { id: "check-1", kind: "checklist", title: "Done when", fields: { items: [{ label: "Tests", done: true }] }, fieldsHash: "c", summary: "1 of 1 done", presentedBy: { session: "brain-a" }, presenterLive: false },
  ];
  const copied = [];
  const { window, document, posts } = await bootWorkTable(fixture);
  Object.defineProperty(window.navigator, "clipboard", { value: {
    /** Records one clipboard write. */
    writeText: async (value) => copied.push(value),
  } });
  const opened = [];
  window.open = (...args) => { opened.push(args); return {}; };
  const cards = [...document.querySelectorAll("[data-card-id]")];
  assert.equal(cards.length, 2, "one Document and two cards use the three-row render budget");
  assert.match(document.querySelector("[data-work-cursor^='document-more:']").textContent, /and 1 more/);
  assert.equal(cards[0].querySelector("[data-work-row-title]").getAttribute("aria-label"), "copy: Review request, presented by brain-a");
  assert.ok([...cards[0].querySelectorAll("button")].every((button) => button.hasAttribute("aria-keyshortcuts")));
  cards[0].querySelector("[data-card-action]").click();
  await settle(window);
  assert.deepEqual(copied, ["Please review"]);
  cards[1].querySelector("[data-card-action]").click();
  assert.deepEqual(opened[0], ["https://example.com/", "_blank", "noopener"]);
  cards[0].querySelector("[data-card-dismiss]").click();
  await settle(window);
  assert.deepEqual(posts.at(-1), { path: "/api/goals/dismiss-card", body: { goal: goal.file, id: "copy-1" } });
});

test("presented Documents stay on Work after Enter opens one, o is the full-reader alias, and x dismisses only its own row", async () => {
  const fixture = workTableFixture();
  const goal = fixture.goals[0];
  goal.presentations = [1, 2].map((number) => ({
    file: `otto/onboarding/design-${number}.md`, root: "vault", title: `Readable design ${number}`,
    presentedBy: { session: "worker-a" }, presentedAt: `2026-08-28T00:00:0${number}.000Z`, note: "",
  }));
  /** Serves one fake Document for any reader request. */
  const documentRecord = (url) => ({ file: url.searchParams.get("file"), title: "Readable design", hash: "h1", markdown: "# Readable design\n\nBody.", html: "<h1>Readable design</h1><p>Body.</p>", headings: [], comments: [] });
  const { window, document, posts } = await bootWorkTable(fixture, { documentRecord });
  /** Reads the presented file under the Work cursor. */
  const rowFile = () => document.querySelector("[data-presentation-goal].cursor")?.dataset.presentationFile;
  /** Lists the presented files rendered beneath the Goal. */
  const rows = () => [...document.querySelectorAll("[data-presentation-goal]")].map((row) => row.dataset.presentationFile);
  const first = document.querySelector("[data-presentation-goal]");
  first.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  first.querySelector("[data-work-row-title]").focus();
  press(window, "Enter");
  await settle(window);
  assert.equal(window.document.querySelector("#document-peek-layer").hidden, false, "Enter opens the highlighted Document in the quick layer");
  assert.equal(posts.filter((post) => post.path === "/api/goals/presented-opened").length, 1, "opening is recorded once");
  press(window, "Escape");
  await settle(window);
  assert.deepEqual(rows(), ["otto/onboarding/design-1.md", "otto/onboarding/design-2.md"], "opening removes nothing: both presentations stay beneath the Goal");
  assert.equal(rowFile(), "otto/onboarding/design-1.md", "Escape returns to the same presented row");
  press(window, "o");
  await settle(window);
  assert.equal(window.document.querySelector("#document-peek-layer").hidden, true, "o leaves the quick layer for the full reader");
  assert.ok(window.document.querySelector("#screen .document-reader"), "o opens the full reader");
  press(window, "Escape");
  await settle(window);
  assert.equal(window.document.querySelector("#screen .document-reader"), null, "Escape leaves the reader");
  assert.equal(rowFile(), "otto/onboarding/design-1.md", "the cursor is back on the presented row");
  press(window, "x");
  await settle(window);
  const dismiss = posts.at(-1);
  assert.equal(dismiss.path, "/api/goals/dismiss-presentation", "x dismisses directly on Julian's word, not through the brain's withdraw");
  assert.deepEqual(dismiss.body, {
    goal: "otto/onboarding/goal-walkthrough.md",
    file: "otto/onboarding/design-1.md",
    operationId: dismiss.body.operationId,
  }, "x sends the same exact Goal presentation as its visible dismiss control");
  assert.equal(posts.some((post) => post.path === "/api/goals/withdraw-presentation"), false);
});

test("Area presentations use the Document readers and Area routes without a Goal", async () => {
  const fixture = workTableFixture();
  const area = fixture.vault.areas.find((item) => item.path === "otto/tangent");
  area.presentations = [{ file: "otto/tangent/design-area.md", root: "vault", title: "Area direction", presentedBy: { session: "otto-tangent--brain" }, presentedAt: "2026-08-28T00:00:00Z", note: "Read this" }];
  /** Serves the presented Area Document. */
  const documentRecord = (url) => ({ file: url.searchParams.get("file"), title: "Area direction", hash: "h1", markdown: "# Area direction", html: "<h1>Area direction</h1>", headings: [], comments: [] });
  const { window, document, posts } = await bootWorkTable(fixture, { documentRecord });
  const row = document.querySelector("[data-presentation-area='otto/tangent']");
  assert.ok(row, "the presentation appears below its Area header");
  assert.equal(row.dataset.presentationGoal, undefined, "the row has no Goal identity");
  row.querySelector("[data-open-document]").click();
  await settle(window);
  assert.deepEqual(posts.find((post) => post.path === "/api/areas/presented-opened")?.body, { area: "otto/tangent", file: "otto/tangent/design-area.md", hash: "h1" });
  assert.equal(document.querySelectorAll("[data-presentation-area='otto/tangent']").length, 1, "opening keeps the Area presentation");
  row.querySelector("[data-withdraw-presentation]").click();
  await settle(window);
  assert.deepEqual(posts.at(-1), { path: "/api/areas/dismiss-presentation", body: { area: "otto/tangent", file: "otto/tangent/design-area.md", operationId: posts.at(-1).body.operationId } });
});

test("Area presentation keys preserve owner scope and restore focus after dismissal", async () => {
  const fixture = workTableFixture();
  const area = fixture.vault.areas.find((item) => item.path === "otto/tangent");
  area.presentations = [{ file: "otto/tangent/design-area-keyboard.md", root: "vault", title: "Area keyboard", presentedBy: { session: "otto-tangent--brain" }, presentedAt: "2026-08-28T00:00:00Z", note: "Read this" }];
  /** Serves the Area Document opened by the keyboard. */
  const documentRecord = (url) => ({ file: url.searchParams.get("file"), title: "Area keyboard", hash: "h1", markdown: "# Area keyboard", html: "<h1>Area keyboard</h1>", headings: [], comments: [] });
  const { window, document, posts } = await bootWorkTable(fixture, { documentRecord });
  const row = document.querySelector("[data-presentation-area='otto/tangent']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "o");
  await settle(window);
  assert.ok(document.querySelector("#screen .document-reader"), "o opens an Area presentation in the full reader");
  assert.deepEqual(posts.find((post) => post.path === "/api/areas/presented-opened")?.body, { area: area.path, file: "otto/tangent/design-area-keyboard.md", hash: "h1" });
  assert.equal(posts.filter((post) => post.path === "/api/goals/presented-opened").length, 0, "o preserves the selected Area scope");
  press(window, "Escape");
  await settle(window);
  press(window, "x");
  await settle(window);
  assert.deepEqual(posts.at(-1), { path: "/api/areas/dismiss-presentation", body: { area: area.path, file: "otto/tangent/design-area-keyboard.md", operationId: posts.at(-1).body.operationId } });
  assert.ok(document.activeElement.closest("[data-work-cursor]"), "dismissal restores focus to surviving Work");
});

test("duplicate presented files keep owner-scoped selection for keyboard and pointer dismissal", async () => {
  const fixture = workTableFixture();
  const [firstGoal, secondGoal] = fixture.goals;
  const area = fixture.vault.areas.find((item) => item.path === "otto/tangent");
  const file = "otto/shared/design.md";
  /** Builds one owner-specific presentation of the shared file. */
  const presentation = (title) => ({ file, root: "vault", title, presentedBy: { session: "presenter" }, presentedAt: "2026-08-28T00:00:00Z", note: "" });
  firstGoal.presentations = [presentation("First Goal copy")];
  secondGoal.presentations = [presentation("Second Goal copy")];
  area.presentations = [presentation("Area copy")];
  /** Serves the one file shared by all presentation owners. */
  const documentRecord = () => ({ file, title: "Shared design", hash: "shared-hash", markdown: "# Shared design", html: "<h1>Shared design</h1>", headings: [], comments: [] });
  /** Applies a successful dismissal to the fixture returned by refresh. */
  const postHandler = ({ path, body, fixture: current }) => {
    if (path === "/api/goals/dismiss-presentation") {
      const owner = current.goals.find((goal) => goal.file === body.goal);
      owner.presentations = owner.presentations.filter((item) => item.file !== body.file);
    }
    if (path === "/api/areas/dismiss-presentation") {
      const owner = current.vault.areas.find((item) => item.path === body.area);
      owner.presentations = owner.presentations.filter((item) => item.file !== body.file);
    }
    return { ok: true };
  };
  const { window, document, posts } = await bootWorkTable(fixture, { documentRecord, postHandler });
  /** Selects the shared file under one exact Goal owner. */
  const selector = (owner) => `[data-presentation-goal='${owner}'][data-presentation-file='${file}']`;
  const cursors = [
    document.querySelector(selector(firstGoal.file)).dataset.workCursor,
    document.querySelector(selector(secondGoal.file)).dataset.workCursor,
    document.querySelector(`[data-presentation-area='${area.path}'][data-presentation-file='${file}']`).dataset.workCursor,
  ];
  assert.equal(new Set(cursors).size, 3, "the same file has one selection identity per owner");

  let row = document.querySelector(selector(secondGoal.file));
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row.querySelector("[data-work-row-title]").focus();
  press(window, "/");
  press(window, "x");
  assert.equal(posts.length, 0, "x in Work text entry does not dismiss the selected row");
  press(window, "Escape");
  await settle(window);
  press(window, "x");
  await settle(window);
  assert.deepEqual(posts.at(-1), { path: "/api/goals/dismiss-presentation", body: { goal: secondGoal.file, file, operationId: posts.at(-1).body.operationId } });
  assert.ok(document.querySelector(selector(firstGoal.file)), "the duplicate under the other Goal remains");
  assert.ok(document.querySelector(`[data-presentation-area='${area.path}'][data-presentation-file='${file}']`), "the duplicate under the Area remains");
  assert.equal(document.querySelector(selector(secondGoal.file)), null, "only the selected Goal presentation leaves");
  assert.ok(document.activeElement.closest("[data-work-cursor]"), "keyboard dismissal focuses surviving Work");

  row = document.querySelector(`[data-presentation-area='${area.path}'][data-presentation-file='${file}']`);
  row.querySelector("[data-withdraw-presentation]").click();
  await settle(window);
  assert.deepEqual(posts.at(-1), { path: "/api/areas/dismiss-presentation", body: { area: area.path, file, operationId: posts.at(-1).body.operationId } });
  assert.ok(document.querySelector(selector(firstGoal.file)), "the visible Area control leaves the Goal-owned duplicate alone");
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
  for (const trigger of document.querySelectorAll(".work-table .desk-action-menu-trigger")) {
    assert.match(trigger.getAttribute("aria-label"), /^Keys for .+/, "an icon-only key-sheet trigger names its object");
  }
  assert.equal(document.querySelectorAll(".work-table th:empty").length, 0, "no header cell is empty");
});

test("Area pointers, toolbar help, and the state-owned action surface share one command registry", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const ids = ["previousArea", "nextArea", "session", "stopAgent", "defaults", "messageBrain", "starArea", "chooseAreas", "collapse", "expand", "questions", "note"];
  document.querySelector("[data-work-group='otto/onboarding'] [data-work-object-actions]").click();
  await settle(window);
  for (const id of ids) {
    const command = workCommand(id);
    const pointer = document.querySelector(`[data-modal-action='${id}']`);
    assert.ok(pointer, `${id} has a pointer on its Area action surface`);
    assert.equal(pointer.dataset.modalKey, command.keyDisplay);
    assert.match(pointer.textContent, new RegExp(command.label));
  }
  for (const id of ["keys", "search"]) {
    const command = workCommand(id);
    const pointer = document.querySelector(`.work-caption [data-work-caption-command='${id}']`);
    assert.ok(pointer, `${id} is a pointer on the caption key line (work-screen-refresh D7)`);
    assert.equal(pointer.querySelector("kbd").textContent, command.keyDisplay);
    assert.equal(pointer.getAttribute("aria-keyshortcuts"), command.ariaKeyshortcuts);
  }
  document.querySelector("[data-modal-action='stopAgent']").click();
  await settle(window);
  assert.match(document.querySelector("#modal-title").textContent, /Stop the Onboarding brain/, "action-surface stop runs the guarded confirmation");
  document.querySelector("[data-modal-cancel]").click();

  document.querySelector("[data-work-group='otto/onboarding'] [data-work-object-actions]").click();
  await settle(window);
  document.querySelector("[data-modal-action='defaults']").click();
  await settle(window);
  assert.equal(document.querySelector("[data-launch-popover]")?.getAttribute("aria-label"), "Default agents", "action-surface defaults runs the same Area settings pointer");
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
  assert.equal(childRow.closest("[data-work-group]").dataset.workGroup, "otto/onboarding", "the descendant Goal stays in the parent's row group");
  assert.equal(childRow.previousElementSibling.dataset.workSubArea, "otto/onboarding/lessons", "a sub-Area header sits directly above its Goal");
  childRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "d");
  await settle(window);
  assert.match(document.querySelector("[data-launch-popover] header").textContent, /Otto \/ Onboarding \/ Lessons/, "d opens the nearest header's defaults, the sub-Area");
  document.querySelector("[data-launch-close]").click();

  const parentRow = document.querySelector("[data-goal-anchor='otto/onboarding/goal-walkthrough.md']");
  parentRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "a");
  await settle(window);
  assert.equal(document.querySelector("#describe-area").value, "otto/onboarding", "a on the Area's own Goal row messages the top-level brain");
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
  tangentGoal.querySelector(".work-cell-status .desk-state").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "{", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, standards, "Shift-[ resolves an agent through its descendant Goal row");

  document.querySelector("[data-goal-anchor='otto/tangent/goal-compact-table.md'] .desk-goal-elapsed").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "{", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, standards, "Shift-[ resolves the elapsed time through its descendant Goal row");

  document.querySelector(`[data-work-group='otto/standards'] [data-work-object-actions]`).click();
  await settle(window);
  document.querySelector("[data-modal-action='previousArea']").click();
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, onboarding, "the visible previous action runs the same jump");

  document.querySelector(`[data-work-group='otto/onboarding'] [data-work-object-actions]`).click();
  await settle(window);
  document.querySelector("[data-modal-action='nextArea']").click();
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, standards, "the action surface runs the same next-Area action");

  document.querySelector(`[data-work-group='otto/tangent'] [data-work-object-actions]`).click();
  await settle(window);
  document.querySelector("[data-modal-action='nextArea']").click();
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, tangent, "the final Area holds at the boundary");
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
  assert.match(verb(counts[0]), /^\d+ questions?$/);
});

test("slash search moves the cursor like Vim: incremental, n and N, Enter keeps, Escape restores", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  assert.equal(titles(document).length, 7);
  const origin = document.querySelector("[data-work-cursor].cursor").dataset.workCursor;
  document.querySelector("[data-work-cursor-control]").focus();
  press(window, "/");
  const bar = document.querySelector("#work-search");
  const search = document.querySelector("#work-search-input");
  assert.equal(bar.hidden, false, "/ shows the search line");
  assert.equal(document.activeElement, search, "/ gives the line the keyboard");
  assert.match(document.querySelector("#work-search-keys").textContent, /jump.*next.*previous.*cancel/, "the line prints its keys");

  search.value = "walkthrough";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  assert.equal(document.activeElement, search, "typing keeps the keyboard in the line");
  assert.equal(titles(document).length, 7, "search never hides a row");
  const landed = document.querySelector("[data-work-cursor].cursor");
  assert.match(landed.dataset.searchText, /walkthrough/, "the cursor follows the first match");
  assert.ok(landed.classList.contains("search-match"), "matches are marked");
  assert.equal(document.querySelectorAll(".search-match").length, 1);
  assert.equal(document.querySelector("#work-search-count").textContent, "1/1");
  const region = document.querySelector("#filter-count");
  assert.equal(region.getAttribute("aria-live"), "polite", "the count lives in a polite region");
  assert.equal(region.textContent, "Match 1 of 1", "the region states the match position");

  search.value = "zzzznothing";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  assert.equal(document.querySelector("#work-search-count").textContent, "no match");
  assert.equal(document.querySelectorAll(".search-match").length, 0);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, origin, "no match shows the cursor at the origin");

  search.value = "otto";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  const matches = [...document.querySelectorAll(".search-match")].map((row) => row.dataset.workCursor);
  assert.ok(matches.length >= 3, "several rows say otto");
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, matches[0]);
  press(window, "ArrowDown");
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, matches[1], "Arrow Down steps to the next match while typing");
  assert.equal(document.activeElement, search, "stepping never steals the keyboard from the line");

  press(window, "Enter");
  await settle(window);
  assert.equal(bar.hidden, false, "Enter keeps the line visible with the pattern");
  assert.ok(bar.classList.contains("quiet"));
  assert.match(document.querySelector("#work-search-keys").textContent, /n.*next.*N.*previous.*esc.*clear/, "the kept line prints n, N, and Escape");
  assert.ok(document.activeElement.closest("[data-work-cursor]"), "Enter hands the keyboard to the matched row");
  press(window, "n");
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, matches[2], "n moves to the next match");
  for (let step = 3; step < matches.length; step += 1) { press(window, "n"); await settle(window); }
  press(window, "n");
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, matches[0], "n wraps to the first match");
  assert.match(document.querySelector("#work-search-count").textContent, /wrapped/);
  press(window, "N", { shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, matches.at(-1), "N wraps back to the last match");

  press(window, "Escape");
  await settle(window);
  assert.equal(bar.hidden, true, "Escape clears the kept search");
  assert.equal(document.querySelectorAll(".search-match").length, 0);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, matches.at(-1), "clearing keeps the cursor where n left it");

  press(window, "/");
  search.value = "walkthrough";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle(window);
  press(window, "Escape");
  await settle(window);
  assert.equal(bar.hidden, true);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, matches.at(-1), "Escape while typing returns to the origin row");
});

test("arrows, Home, End, PageDown, and Ctrl-D are synonyms of j, k, gg, G, and half a page on the one cursor", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  /** The visible cursor id. */
  const cursor = () => document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor;
  const all = [...document.querySelectorAll("[data-work-cursor]")].filter((row) => !row.hidden).map((row) => row.dataset.workCursor);
  document.querySelector("[data-work-cursor-control]").focus();
  press(window, "Home");
  await settle(window);
  assert.equal(cursor(), all[0], "Home is gg");
  const moved = press(window, "ArrowDown");
  await settle(window);
  assert.equal(moved.defaultPrevented, true, "the cursor owns the arrow key");
  assert.equal(cursor(), all[1], "Arrow Down is j");
  assert.equal(document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor, all[1], "focus follows the cursor");
  press(window, "ArrowUp");
  await settle(window);
  assert.equal(cursor(), all[0], "Arrow Up is k");
  press(window, "ArrowUp");
  await settle(window);
  assert.equal(cursor(), all[0], "the first row holds at the top");
  press(window, "End");
  await settle(window);
  assert.equal(cursor(), all.at(-1), "End is G");
  press(window, "u", { ctrlKey: true });
  await settle(window);
  const afterHalfUp = all.indexOf(cursor());
  assert.ok(afterHalfUp < all.length - 1, "Ctrl-U moves up");
  press(window, "PageDown");
  await settle(window);
  assert.ok(all.indexOf(cursor()) > afterHalfUp, "PageDown moves down like Ctrl-D");

  titles(document)[0].click();
  await settle(window);
  assert.ok(document.querySelector(".document-reader, .work-page"), "Enter or a click on the title opens the Goal, never an agent");
});

test("the Goal title opens the Goal; the Agent cell keeps the agent route", async () => {
  const live = await bootWorkTable(workTableFixture());
  const running = live.document.querySelector("tr[data-goal-anchor$='goal-framework-docs.md']");
  assert.ok(running.querySelector("[data-work-row-title][data-open-close]"), "a live Goal title opens the Goal; its agent is Command-Shift-Enter");
  const agent = running.querySelector(".work-cell-agent [data-open-goal-run]");
  assert.ok(agent, "the Agent cell keeps the agent route for the pointer");
  assert.match(agent.textContent, /Claude/, "the agent name is on the Agent cell");
  assert.equal(agent.querySelector("kbd").textContent, workCommand("session").keyDisplay, "the Agent cell teaches the registered key that enters the run (work-screen-refresh D5)");
  assert.equal(running.querySelector(".work-row-agent, .work-row-step"), null, "no agent or step line under the title");

  const stopped = live.document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md']");
  assert.ok(stopped.querySelector("[data-work-row-title][data-open-close]"), "a Goal without an openable run opens its durable context");
  assert.match(stopped.querySelector(".work-cell-agent .work-agent-ref.past").textContent, /3\/3$/, "a stopped run prints its last launch muted with the step count");
  assert.equal(stopped.querySelector(".work-cell-agent kbd"), null, "a stopped run prints no key");

  const planned = await bootWorkTable(plannedWorkFixture());
  assert.ok(planned.document.querySelector("tr[data-goal-anchor$='goal-startable.md'] [data-work-row-title][data-open-close]"), "an open Goal with no session opens its reader: only the brain starts an agent (D8)");
  assert.equal(planned.document.querySelector("tr[data-goal-anchor] [data-launch-for]"), null, "no Goal row opens a launch chooser");
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
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, goals.at(-1).dataset.workCursor, "plain G selects the last navigable row");
  press(window, "1");
  press(window, "G");
  await settle(window);
  assert.match(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor ?? "", /^area:/, "1G selects the first navigable row");
  press(window, "2");
  press(window, "G");
  await settle(window);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, goals[0].dataset.workCursor, "2G selects the second navigable row");
  press(window, "/");
  press(window, "j");
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, goals[0].dataset.workCursor, "a bare key in the search line does not move the cursor");
  press(window, "Escape");
  await settle(window);
});

test("Command-Shift-Enter opens and closes the one session layer without destroying Work", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const row = document.querySelector("[data-work-cursor='goal:otto/standards/goal-framework-docs.md']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("#session-layer").hidden, false);
  assert.ok(document.querySelector("table.work-table"), "Work remains mounted below the session");
  assert.equal(document.querySelector("#session-layer-terminal").dataset.session, "standards--docs");
  assert.equal(document.querySelector("#session-layer-title strong").textContent, "Land standards framework docs", "the Goal names the session");
  assert.match(document.querySelector("#session-layer-title span").textContent, /Claude/, "the agent sits below its Goal in the session header");
  press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("#session-layer").hidden, true);
  assert.equal(document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor, row.dataset.workCursor);
});

test("an Area brain row takes the cursor and Command-Shift-Enter enters its Brain pane", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const row = document.querySelector("[data-work-cursor='area:otto/tangent']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  assert.ok(document.querySelector("[data-work-cursor='area:otto/tangent']").classList.contains("cursor"), "the visible cursor sits on the Area brain row");
  press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("[data-map-brain-pane] .map-brain-terminal").dataset.session, "otto-tangent--brain");
  assert.match(document.querySelector("[data-map-brain-pane] > header").textContent, /Brain working/);
  assert.equal(document.querySelector("[data-toggle-workspace-map]").textContent, "Map");
});

test("Command-Shift-Enter opens the brain chooser on an inactive Area and b does nothing", async () => {
  const fixture = withBrainOnlyArea(workTableFixture(), { live: false });
  const { window, document } = await bootWorkTable(fixture);
  const row = document.querySelector("[data-work-cursor='area:otto/quiet']");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "b");
  await settle(window);
  assert.equal(document.querySelector("[data-launch-popover]"), null, "b does not open the brain chooser");
  press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window);
  assert.ok(document.querySelector("[data-launch-popover]"), "the shared agent-entry key opens the brain chooser");
  assert.match(document.querySelector("[data-launch-popover] header").textContent, /Otto \/ Quiet/);
});

test("Work keys expose their help and stay inert in text and terminal input", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const initial = document.querySelector("[data-work-cursor].cursor").dataset.workCursor;
  press(window, "/");
  assert.equal(document.activeElement.id, "work-search-input", "slash opens the Work search line");
  for (const key of ["j", "k", "g", "G", "b", "?"]) press(window, key);
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, initial, "bare Work keys do nothing in the search line");
  press(window, "Escape");
  await settle(window);
  press(window, "?");
  await settle(window);
  assert.equal(document.querySelector("#modal-kicker").textContent, "Area keys", "? on an Area row opens that Area's sheet");
  const helpRows = [...document.querySelectorAll("[data-modal-action]")];
  const ids = helpRows.map((row) => row.dataset.modalAction);
  for (const id of ["moveRows", "firstLast", "halfPage", "open", "session", "search", "stopAgent", "defaults", "starArea"]) assert.ok(ids.includes(id), `the sheet lists ${id}: ${ids.join(" ")}`);
  assert.equal(ids.includes("commands"), false, "there is no second command menu");
  assert.equal(ids.includes("keys"), false, "the sheet does not list itself");
  assert.equal(helpRows.find((row) => row.dataset.modalKey === "s")?.querySelector("strong")?.textContent, "Stop agent");
  assert.equal(helpRows.find((row) => row.dataset.modalKey === "d")?.querySelector("strong")?.textContent, "Defaults");
  assert.equal(helpRows.find((row) => row.dataset.modalAction === "nextMatch")?.getAttribute("aria-disabled"), "true", "n waits for a search");
  const before = document.querySelector("[data-work-cursor].cursor").dataset.workCursor;
  document.querySelector("[data-modal-action='moveRows']").click();
  await settle(window);
  assert.equal(document.querySelector("#modal-layer").hidden, true, "picking a row closes the sheet");
  assert.notEqual(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, before, "picking Move between rows moves the cursor once");

  const live = document.querySelector("[data-work-cursor='goal:otto/standards/goal-framework-docs.md']");
  live.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window);
  const terminalInput = document.querySelector("#session-layer-terminal");
  terminalInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }));
  assert.equal(document.querySelector("[data-work-cursor].cursor").dataset.workCursor, live.dataset.workCursor, "bare keys in the terminal do not move Work");
});

test("Command-Shift-Enter refuses a row with no live session and an outside click closes a live one", async () => {
  const { window, document } = await bootWorkTable(workTableFixture());
  const stopped = document.querySelector("[data-work-cursor='goal:otto/onboarding/goal-walkthrough.md']");
  stopped.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window);
  assert.equal(document.querySelector("#session-layer").hidden, true, "enter never starts a missing session");
  assert.match(document.querySelector("#describe-work")?.value ?? "", /^Start an agent on /, "a Goal with no session asks the brain, the same route as its Open control");
  press(window, "Escape");
  await settle(window);

  const live = document.querySelector("[data-work-cursor='goal:otto/standards/goal-framework-docs.md']");
  live.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
  press(window, "Enter", { metaKey: true, shiftKey: true });
  await settle(window);
  document.querySelector("#session-layer").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(document.querySelector("#session-layer").hidden, true);
  assert.ok(document.querySelector("table.work-table"), "outside close leaves Work mounted");
});

test("Work has no checkbox column or shared browser selection state", async () => {
  const { document, posts } = await bootWorkTable(plannedWorkFixture(), { workFilter: "inactive" });
  assert.equal(document.querySelector(".work-col-select, .work-cell-select, [data-check-goal], [data-start-selected]"), null);
  assert.equal(document.querySelectorAll("tr.work-row.selected").length, 0);
  assert.equal(posts.length, 0, "rendering Work never starts work");
});

test("a poll that changes the facts keeps focus on the same control", async () => {
  const fixture = workTableFixture();
  const { window, document } = await bootWorkTable(fixture);
  const action = document.querySelector("tr[data-goal-anchor$='goal-compact-table.md'] .work-cell-agent .work-agent-ref");
  const key = action.dataset.focusKey;
  action.focus();
  assert.equal(document.activeElement, action);

  // The next poll finds the step waiting instead of working: the row stays, its
  // text changes, and the focused control must survive the repaint.
  fixture.sessions.find((session) => session.name === "tangent--table").state = "waiting";
  fixture.pipelines.find((pipeline) => pipeline.goal.endsWith("goal-compact-table.md")).steps[0].state = "waiting";
  await window.refresh();
  await settle(window);

  const after = document.querySelector("tr[data-goal-anchor$='goal-compact-table.md'] .work-cell-agent .work-agent-ref");
  assert.equal(after, action, "a changed fact retains the keyed row control");
  assert.match(document.querySelector("tr[data-goal-anchor$='goal-compact-table.md'] .desk-state").textContent, /^Waiting for you$/);
  assert.equal(document.activeElement.dataset.focusKey, key, "focus stays on the same control");
});

test("Work keeps lifecycle compact and leaves dependency detail to the Goal reader", async () => {
  const current = await bootWorkTable(withDirectAsks(workTableFixture()));
  /** The lifecycle word one Goal row prints. */
  const stateOf = (document, slug) => document.querySelector(`tr[data-goal-anchor$='goal-${slug}.md'] .desk-state`).textContent.trim();
  assert.equal(stateOf(current.document, "stays-online"), "Ready for validation", "a finished result Julian must accept");
  assert.equal(stateOf(current.document, "walkthrough"), "Stopped");
  assert.match(current.document.querySelector("tr[data-goal-anchor$='goal-walkthrough.md'] .work-cell-agent").textContent, /codex.* · 3\/3/, "the Agent cell prints the last launch and the step once");
  assert.equal(current.document.querySelectorAll(".work-table .work-readiness").length, 0, "Current work shows no readiness line");

  const planned = await bootWorkTable(plannedWorkFixture(), { workFilter: "inactive" });
  for (const slug of ["startable", "blocked", "broken", "errored"]) {
    assert.equal(stateOf(planned.document, slug), "Open", `${slug} is Open, never Ready`);
  }
  assert.equal(planned.document.querySelector(".work-readiness, .work-blocker-preview"), null, "readiness and folded dependency previews left Work");

  for (const slug of ["startable", "blocked", "broken", "errored"]) {
    const row = planned.document.querySelector(`tr[data-goal-anchor$='goal-${slug}.md']`);
    assert.equal(row.querySelector(".work-cell-agent").textContent.trim(), "—", `${slug} has no agent; the row offers no start of its own (D8)`);
    assert.equal(row.querySelector("[data-open-goal-run], [data-launch-for]"), null, `${slug} has no run route`);
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
  const toggle = document.querySelector(`[data-work-tree-goal='${parent.file}']`);
  assert.ok(toggle, "a parent Goal with Subgoals gets one disclosure");
  const subgoalRow = document.querySelector(`tr[data-subgoal-of='${parent.file}']`);
  assert.equal(subgoalRow.parentElement.tagName, "TBODY", "a Subgoal row stays a row of its group");
  assert.equal(subgoalRow.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  toggle.click();
  await settle(window);
  const hidden = document.querySelector(`tr[data-subgoal-of='${parent.file}']`);
  assert.equal(hidden.hidden, true, "the disclosure hides the following Subgoal rows");
  assert.equal(document.querySelector(`[data-work-tree-goal='${parent.file}']`).getAttribute("aria-expanded"), "false");
  assert.equal(titles(document).length, 7, "a hidden Subgoal leaves the arrow-key path");
});

test("h and l collapse, expand, and traverse Area and Subgoal tree nodes", async () => {
  const fixture = workTableFixture();
  const parent = fixture.goals.find((goal) => goal.slug === "compact-table");
  const child = { ...parent, slug: "compact-table-css", file: "otto/tangent/goal-compact-table-css.md", title: "Write the table CSS", depth: 1, session: null, firstStartAt: null };
  const area = fixture.vault.areas.find((item) => item.path === "otto/tangent");
  area.goals.splice(area.goals.indexOf(parent) + 1, 0, child);
  fixture.vault.map.find((item) => item.path === "otto/tangent").goals = area.goals;

  const { window, document } = await bootWorkTable(fixture);
  const areaRow = document.querySelector("[data-work-group='otto/onboarding'] .work-group-row");
  areaRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  areaRow.querySelector("[data-work-cursor-control]").focus();
  press(window, "h");
  await settle(window);
  assert.ok(document.querySelector("[data-work-group='otto/onboarding']").classList.contains("folded"));
  assert.equal(document.activeElement.closest("[data-work-cursor]")?.dataset.workCursor, "area:otto/onboarding", "collapse keeps focus on the Area");
  press(window, "l");
  await settle(window);
  assert.equal(document.querySelector("[data-work-group='otto/onboarding']").classList.contains("folded"), false);
  press(window, "l");
  await settle(window);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, "otto/onboarding/goal-walkthrough.md", "l on an expanded Area enters its first child");

  let parentRow = document.querySelector(`[data-goal-anchor='${parent.file}']`);
  parentRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  parentRow.querySelector("[data-work-row-title]").focus();
  press(window, "h");
  await settle(window);
  assert.equal(document.querySelector(`tr[data-subgoal-of='${parent.file}']`).hidden, true);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, parent.file);
  press(window, "l");
  await settle(window);
  press(window, "l");
  await settle(window);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, child.file, "l on an expanded Goal enters its first Subgoal");
  press(window, "h");
  await settle(window);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, parent.file, "h on a leaf returns to its parent");
});

test("nested Subgoals keep their real parents and every collapsed ancestor hides its branch", async () => {
  const fixture = workTableFixture();
  const parent = fixture.goals.find((goal) => goal.slug === "compact-table");
  const child = { ...parent, slug: "compact-table-css", file: "otto/tangent/goal-compact-table-css.md", title: "Write the table CSS", depth: 1, session: null, firstStartAt: null };
  const grandchild = { ...parent, slug: "compact-table-grid", file: "otto/tangent/goal-compact-table-grid.md", title: "Prove the nested grid", depth: 2, session: null, firstStartAt: null };
  const sibling = { ...parent, slug: "compact-table-copy", file: "otto/tangent/goal-compact-table-copy.md", title: "Tighten the table copy", depth: 1, session: null, firstStartAt: null };
  const area = fixture.vault.areas.find((item) => item.path === "otto/tangent");
  area.goals.splice(area.goals.indexOf(parent) + 1, 0, child, grandchild, sibling);
  fixture.vault.map.find((item) => item.path === "otto/tangent").goals = area.goals;

  const { window, document } = await bootWorkTable(fixture);
  /** Returns the rendered row for one exact Goal file. */
  const row = (file) => document.querySelector(`[data-goal-anchor='${file}']`);
  assert.equal(row(child.file).dataset.subgoalOf, parent.file, "depth 1 belongs to the root");
  assert.equal(row(grandchild.file).dataset.subgoalOf, child.file, "depth 2 belongs to its immediate parent");
  assert.equal(row(sibling.file).dataset.subgoalOf, parent.file, "the next depth-1 Goal leaves the nested branch");
  assert.match(document.querySelector(`[data-work-tree-goal='${parent.file}']`).getAttribute("aria-label"), /2 Subgoals/, "the root counts only direct children");
  assert.match(document.querySelector(`[data-work-tree-goal='${child.file}']`).getAttribute("aria-label"), /1 Subgoal/, "the nested parent owns its disclosure");

  row(parent.file).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  row(parent.file).querySelector("[data-work-row-title]").focus();
  press(window, "h");
  await settle(window);
  assert.equal(row(child.file).hidden, true);
  assert.equal(row(grandchild.file).hidden, true, "the root collapse reaches depth 2");
  assert.equal(row(sibling.file).hidden, true);

  press(window, "l");
  await settle(window);
  press(window, "l");
  await settle(window);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, child.file, "l enters the first direct child");
  press(window, "h");
  await settle(window);
  assert.equal(row(grandchild.file).hidden, true, "h collapses only the nested child's branch");
  assert.equal(row(sibling.file).hidden, false, "a nested collapse leaves its sibling visible");
  press(window, "h");
  await settle(window);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, parent.file, "h on the collapsed child returns to its real parent");
  press(window, "h");
  await settle(window);
  press(window, "l");
  await settle(window);
  assert.equal(row(child.file).hidden, false, "expanding the root restores its direct child");
  assert.equal(row(grandchild.file).hidden, true, "the child's retained collapse still hides the grandchild");
  assert.equal(row(sibling.file).hidden, false);
  press(window, "l");
  await settle(window);
  press(window, "l");
  await settle(window);
  press(window, "l");
  await settle(window);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, grandchild.file, "l expands the nested parent and enters its direct child");
  press(window, "h");
  await settle(window);
  assert.equal(document.activeElement.closest("[data-goal-anchor]")?.dataset.goalAnchor, child.file, "h on the depth-2 leaf returns to depth 1");
});

test("multiple open groups keep independent reader actions without browser selection", async () => {
  const fixture = plannedWorkFixture();
  const other = { ...fixture.goals[0], area: "otto/standards", slug: "standards-startable", file: "otto/standards/goal-standards-startable.md", title: "Write the standards index", dependsOn: [] };
  fixture.vault.areas.push({ path: "otto/standards", name: "standards", goals: [other], documents: [] });
  fixture.vault.map.push({ path: "otto/standards", name: "standards", goals: [other] });
  fixture.brains.push({ area: "otto/standards", status: "active", live: true, session: "otto-standards--brain", generation: 1, state: "working", forJulian: [], requests: [] });
  fixture.sessions.push({ name: "otto-standards--brain", area: "otto/standards", kind: "brain", state: "working", command: "claude" });

  const { document } = await bootWorkTable(fixture, { workFilter: "inactive" });
  assert.ok(document.querySelector(`[data-goal-anchor='otto/tangent/goal-startable.md'] [data-open-close]`));
  assert.ok(document.querySelector(`[data-goal-anchor='${other.file}'] [data-open-close]`));
  assert.equal(document.querySelector("[data-goal-anchor] [data-launch-for]"), null, "no Goal row starts an agent: only the brain does (D8)");
  assert.equal(document.querySelector("[data-check-goal], [data-start-selected], tr.work-row.selected"), null);
});

// The density contract, read from the stylesheet the browser loads. A rendered
// measurement of the same fixture in Chrome gave 834.4 px of cards against
// 348 px of table rows at 1440 px, and 17 rows across three groups and 18 rows
// in one group inside the 714 px work region
// (otto/tangent/impl-implement-the-compact-work-table). This test pins the two
// heights those numbers come from, so a later style change cannot lose the
// density quietly.
test("the row height is one line at wide width, two below 1200 px", async () => {
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
  assert.equal(row, 34, "a Goal row is one line (work-screen-refresh D8)");
  assert.equal(group, 28, "a group header is 28 px");
  assert.ok(Math.floor((714 - 3 * group) / row) >= 18, "18 Goal rows fit across three groups in the 714 px work region");
  const narrow = css.slice(css.indexOf("@media (max-width: 1199px)"));
  assert.match(narrow.split("\n").find((line) => line.trimStart().startsWith(".work-row > * {")), /height:\s*48px/, "below 1200 px the Agent line joins the title and the row is 48 px");
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

// The bar is gone (work-screen-refresh D6, section 2.5: three reversals mean
// it has no stable meaning). The Status cell prints the state word and the
// elapsed time once, and every state word explains itself on hover.
test("the Status cell prints one state word and the elapsed time, no bar", async () => {
  const { document } = await bootWorkTable(workTableFixture());
  assert.equal(document.querySelector(".work-table .desk-goal-bar"), null, "no bar on any row");
  const running = document.querySelector("tr[data-goal-anchor$='goal-framework-docs.md'] .work-cell-status");
  assert.match(running.textContent.trim(), /^\S.* · \d/, "a started Goal reads `<word> · <elapsed>`");
  assert.match(running.querySelector(".desk-goal-elapsed").title, /^Started /, "the elapsed hover keeps the start time");
  for (const pill of document.querySelectorAll(".work-table .desk-state")) {
    assert.ok(pill.title.length > 0, `the state word "${pill.textContent.trim()}" has a hover sentence`);
  }
  for (const row of document.querySelectorAll(".work-table tr.work-row")) {
    // The narrow-width copy under the title is the one duplicate, and CSS
    // shows exactly one of the two at every width.
    const wide = row.querySelector(".work-cell-agent").textContent.trim();
    const narrow = row.querySelector(".work-cell-agent-inline").textContent.trim();
    assert.equal(wide, narrow, "the wide cell and the narrow copy print the same agent text");
    const rest = row.textContent.replace(wide, "").replace(narrow, "");
    for (const part of wide.split(" · ").filter((item) => item.includes("/"))) assert.ok(!rest.includes(part), `the launch prints nowhere else on the row: ${part}`);
  }
  const css = await readFile(path.join(here, "public", "shell.css"), "utf8");
  assert.doesNotMatch(css, /desk-goal-bar/, "the bar CSS is gone");
  assert.equal(document.querySelector(".work-page .work-tools"), null, "the toolbar is gone (D7)");
  assert.ok(document.querySelector(".work-caption [data-starred-only]") && document.querySelector(".work-caption [data-active-only]"), "Starred and Active live on the caption line");
  const reveal = css.split("\n").find((line) => line.startsWith(".work-row-controls {"));
  assert.match(reveal, /opacity:\s*0/, "row controls hide with opacity");
  assert.doesNotMatch(reveal, /visibility/, "never with visibility: the narrow layout owns that property");
  assert.match(css, /tr\.cursor \.work-row-controls, tr:hover \.work-row-controls, tr:focus-within \.work-row-controls \{ opacity: 1/, "controls appear on the cursor row, hover, and focus");
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
  assert.equal(verb(button), "brain", "the control prints the one word; the verb is its accessible name (work-screen-refresh D4)");
  assert.equal(button.getAttribute("aria-label"), "Open brain for Otto / Quiet");
  assert.equal(button.dataset.openBrain, "otto-quiet--brain", "the button carries the live brain session");

  const waiting = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { state: "waiting" }));
  const idle = groupHeader(waiting.document, "otto/quiet");
  assert.equal(idle.querySelector(".desk-state"), null, "a brain resting at its composer prints no pill: it asks nothing (D3)");
  assert.ok(idle.querySelector(".work-group-brain[data-open-brain]"), "the header still exists with its brain control");

  const decision = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { state: "waiting", stateDetail: "decision" }));
  const pill = groupHeader(decision.document, "otto/quiet").querySelector(".desk-state");
  assert.match(pill.textContent, /^Brain needs a decision$/);
  assert.equal(pill.className, "desk-state waiting", "a decision takes the waiting colour");
  assert.ok(pill.title, "the pill explains itself on hover");
});

test("a stopped brain keeps its Area's quiet group, and one live brain always remains visible", async () => {
  const stopped = await bootWorkTable(withBrainOnlyArea(workTableFixture(), { live: false }));
  const quiet = stopped.document.querySelector("tbody.work-group[data-work-group='otto/quiet']");
  assert.ok(quiet, "every top-level Area keeps its header, so a stopped brain stays reachable (every Area has a row)");
  assert.equal(quiet.querySelector(".work-group-count").textContent, "0 open");
  assert.equal(quiet.querySelector(".work-group-brain").getAttribute("aria-label"), "Resume brain for Otto / Quiet");

  const withLive = await bootWorkTable(withBrainOnlyArea(plannedWorkFixture(), {}));
  assert.ok(withLive.document.querySelector("tbody.work-group[data-work-group='otto/quiet']"),
    "the one Work projection never hides a live brain");
});

test("working agents and open Questions still outrank the brain word", async () => {
  const { document } = await bootWorkTable(withDirectAsks(withBrainOnlyArea(workTableFixture())));
  assert.match(groupHeader(document, "otto/standards").querySelector(".desk-state").textContent, /^2 working$/,
    "an Area whose agents work reports the agents, not its brain");
  const asked = groupHeader(document, "otto/tangent").querySelector(".desk-state");
  assert.match(verb(asked), /^\d+ questions?$/, "an Area whose brain asked reports the Questions first");
  assert.equal(asked.dataset.reviewQuestions, "otto/tangent", "the count opens the deliberate review");
});

test("starred-only hides a live brain whose Area is not starred", async () => {
  const { document } = await bootWorkTable(withBrainOnlyArea(workTableFixture()), { areaFocus: ["otto/standards"], areaFocusOnly: true });
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
