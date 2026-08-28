// Sub-Area headers in Work (docs/design/work-view-sub-areas/design-record.md
// Decisions 1 to 8). One flat sub-header per sub-Area with open work under
// its top-level Area, named by its relative path, with its own fold, count,
// brain state, brain button, and menu. `b`, `a`, `r`, `h`/`l`, and `:` act
// on the nearest header above the cursor. `{` and `}` visit every header a
// fold has not hidden.

import test from "node:test";
import assert from "node:assert/strict";
import { bootWorkTable, press, settle } from "./work-table-harness.mjs";
import { workTableFixture } from "./work-table-fixture.mjs";
import { workCaptionKeys } from "./public/work-commands.js";

const SHELL = "otto/tangent/shell";
const WORK = "otto/tangent/shell/work";
const KEYS = "otto/tangent/shell/work/keys";

/** Builds one open Goal record with no session. */
function goal(area, slug, title) {
  return {
    mtime: 1, area, slug, file: `${area}/goal-${slug}.md`, title, status: "open",
    doneWhen: `${title} is done.`, waitingOn: "", depth: 0, order: 1, changedAt: Date.now(),
    dependsOn: [], requiredBy: [], unresolvedDependencies: [], documents: [], agents: [],
  };
}

/**
 * The real shape: one top-level Area with three sub-Areas at depths 3 to 5,
 * one with an inactive brain, one with none, one with a brain that asked a
 * question. The deepest is folded away by Julian in one test.
 */
function subAreaFixture() {
  const fixture = workTableFixture();
  const shellGoal = goal(SHELL, "shell-menu", "Print the shell menu keys");
  const workGoals = [goal(WORK, "work-rows", "Align the Work rows"), goal(WORK, "work-caption", "Print the caption keys")];
  const keysGoal = goal(KEYS, "keys-sheet", "List every key in the sheet");
  const areas = [
    { path: SHELL, name: "shell", goals: [shellGoal], documents: [] },
    { path: WORK, name: "work", goals: workGoals, documents: [] },
    { path: KEYS, name: "keys", goals: [keysGoal], documents: [] },
  ];
  fixture.goals.push(shellGoal, ...workGoals, keysGoal);
  fixture.vault.areas.push(...areas);
  fixture.vault.map.push(...areas.map((area) => ({ path: area.path, name: area.name, goals: area.goals })));
  fixture.brains.push(
    { area: SHELL, status: "inactive", live: false, session: "otto-tangent-shell--brain", generation: 2, forJulian: [], requests: [] },
    {
      area: KEYS, status: "active", live: false, session: "otto-tangent-shell-work-keys--brain", generation: 1, forJulian: [],
      requests: [{ id: "req-1", status: "open", kind: "decision", subject: "Which key sheet?", question: "Which key sheet layout?" }],
    },
  );
  return fixture;
}

/**
 * The real vault shape: top-level `otto` with no Goal of its own, a quiet
 * `otto/tangent/notes` with nothing, a live brain at depth 3 on Shell, and a
 * top-level `personal` with nothing under it at all. Julian could not see
 * `otto` because it had no Goals (every Area has a row).
 */
function rootedFixture() {
  const fixture = subAreaFixture();
  const roots = [
    { path: "otto", name: "otto", goals: [], documents: [] },
    { path: "otto/tangent/notes", name: "notes", goals: [], documents: [] },
    { path: "personal", name: "personal", goals: [], documents: [] },
  ];
  fixture.vault.areas.push(...roots);
  fixture.brains = fixture.brains.filter((brain) => brain.area !== SHELL);
  fixture.brains.push({ area: SHELL, status: "active", live: true, session: "otto-tangent-shell--brain", generation: 3, state: "working", forJulian: [], requests: [] });
  fixture.sessions.push({ name: "otto-tangent-shell--brain", area: SHELL, kind: "brain", state: "working", command: "claude" });
  return fixture;
}

/** The cursor row's id. */
function cursorId(document) {
  return document.querySelector("[data-work-cursor].cursor")?.dataset.workCursor;
}

/** Puts the Work cursor on one row by clicking it. */
async function clickRow(window, row) {
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(window);
}

test("one flat sub-header per sub-Area, named by its path below the group, with the Goals under it and no tag", async () => {
  const { document } = await bootWorkTable(subAreaFixture(), { workFilter: "all" });
  const group = document.querySelector("tbody[data-work-group='otto/tangent']");
  assert.equal(document.querySelectorAll("tbody[data-work-group^='otto/tangent/']").length, 0, "a sub-Area is never a peer group");
  const rows = [...group.querySelectorAll("tr[data-work-cursor]")];
  const subHeaders = rows.filter((row) => row.dataset.workSubArea);
  assert.deepEqual(subHeaders.map((row) => row.dataset.workSubArea), [SHELL, WORK, KEYS], "sub-headers sit flat in path order, depth 5 included");
  assert.deepEqual(subHeaders.map((row) => row.querySelector("[data-work-cursor-control]").textContent), ["Shell", "Shell / Work", "Shell / Work / Keys"]);

  const topHeader = rows[0];
  assert.equal(topHeader.dataset.workCursor, "area:otto/tangent");
  assert.match(topHeader.querySelector(".work-group-count").textContent, /^8 open/, "the top-level count still sums every sub-Area");
  const ownRows = rows.slice(1, rows.indexOf(subHeaders[0]));
  assert.deepEqual([...new Set(ownRows.map((row) => row.dataset.workArea))], ["otto/tangent"], "the Area's own Goals stay directly under its header");
  assert.equal(group.querySelector("tr[data-goal-anchor] .work-row-path"), null, "no Goal row carries a path tag: the header names the Area");
  const workRows = rows.slice(rows.indexOf(subHeaders[1]) + 1, rows.indexOf(subHeaders[2]));
  assert.deepEqual(workRows.map((row) => row.dataset.workArea), [WORK, WORK], "each sub-Area's Goals sit under its sub-header");
  for (const row of workRows) assert.ok(row.classList.contains("under-sub-area"), "a Goal under a sub-header indents one level");

  assert.deepEqual(subHeaders.map((row) => row.querySelector(".work-group-count").textContent), ["1 open", "2 open", "1 open · 1 blocker · 1 question"], "a sub-header prints its open count plus blockers");
  assert.deepEqual(subHeaders.map((row) => row.querySelector(".work-group-brain").dataset.brainVerb), ["Resume brain", "Start brain", "Resume brain"], "the brain button's accessible verb is Open, Resume, or Start as on the top-level header");
  for (const row of subHeaders) {
    assert.equal(row.querySelector(".work-group-brain kbd").textContent, "b", "the brain button prints its key on every sub-header");
    assert.equal(row.querySelector(".desk-action-menu-trigger kbd").textContent, ":");
    assert.ok(row.querySelector(".work-fold"), "every sub-header has its own triangle");
    assert.equal(row.querySelector(".work-group-note"), null, "the note signal line is not on a sub-header");
  }
  assert.equal(subHeaders[0].querySelector(".desk-state"), null, "an inactive brain that asked nothing prints no state");
  assert.equal(subHeaders[1].querySelector(".desk-state"), null, "no brain, no state");
  const asking = subHeaders[2].querySelector(".desk-state");
  assert.ok(asking.classList.contains("waiting"), "a brain that asked prints the amber state");
  assert.match(asking.textContent, /1 question\s*r/);
});

test("a folded sub-Area hides its Goals and keeps its count and amber dot, remembered by path", async () => {
  const { window, document } = await bootWorkTable(subAreaFixture(), { workFilter: "all" });
  /** The Keys sub-header as painted now. */
  const header = () => document.querySelector(`tr[data-work-sub-area='${KEYS}']`);
  assert.equal(header().querySelector(".work-fold").textContent, "▾", "a sub-Area opens by default");
  header().querySelector(".work-fold").click();
  await settle(window);
  assert.equal(header().querySelector(".work-fold").textContent, "▸");
  assert.equal(document.querySelector(`tr[data-work-area='${KEYS}'][data-goal-anchor]`), null, "the folded sub-Area's Goals are gone");
  assert.equal(header().querySelector(".work-group-count").textContent, "1 open · 1 blocker · 1 question", "the count stays");
  assert.ok(header().querySelector(".desk-state.waiting"), "the amber state stays");
  assert.ok(document.querySelector(`tr[data-work-area='${WORK}'][data-goal-anchor]`), "a sibling sub-Area stays open");
  assert.match(document.querySelector("tbody[data-work-group='otto/tangent'] .work-group-count").textContent, /^8 open/, "the top-level count still includes the hidden Goals");
  assert.deepEqual(JSON.parse(window.localStorage.getItem("agent-shell.folded-work-areas")), [KEYS], "the fold lives in the one folded-Areas store");

  header().querySelector(".work-fold").click();
  await settle(window);
  assert.ok(document.querySelector(`tr[data-work-area='${KEYS}'][data-goal-anchor]`), "unfold brings the Goals back");
});

test("{ and } visit every header a fold has not hidden, top-level and sub, with no wrap", async () => {
  const { window, document } = await bootWorkTable(subAreaFixture(), { workFilter: "all" });
  await clickRow(window, document.querySelector("tbody[data-work-group='otto/tangent'] .work-group-row"));
  const steps = [];
  for (let index = 0; index < 4; index += 1) {
    press(window, "}", { shiftKey: true });
    await settle(window);
    steps.push(cursorId(document));
  }
  assert.deepEqual(steps, [`area:${SHELL}`, `area:${WORK}`, `area:${KEYS}`, `area:${KEYS}`], "} walks the sub-headers in order and holds at the last one");
  press(window, "{", { shiftKey: true });
  await settle(window);
  assert.equal(cursorId(document), `area:${WORK}`);

  // Fold the middle sub-Area: its row stays a header and is still visited,
  // its Goals are not rows any more.
  press(window, "h");
  await settle(window);
  assert.equal(document.querySelector(`tr[data-work-sub-area='${WORK}'] .work-fold`).textContent, "▸");
  press(window, "{", { shiftKey: true });
  await settle(window);
  assert.equal(cursorId(document), `area:${SHELL}`);
  press(window, "}", { shiftKey: true });
  await settle(window);
  assert.equal(cursorId(document), `area:${WORK}`, "a folded sub-header is still a header");

  // Fold the top-level Area: every sub-header under it is hidden, so } from
  // the Area before it lands on the folded header and stops there.
  await clickRow(window, document.querySelector("tbody[data-work-group='otto/tangent'] .work-group-row"));
  press(window, "h");
  await settle(window);
  assert.equal(document.querySelectorAll("tr[data-work-sub-area]").length, 0, "a folded Area hides its sub-headers");
  await clickRow(window, document.querySelector("tbody[data-work-group='otto/standards'] .work-group-row"));
  press(window, "}", { shiftKey: true });
  await settle(window);
  assert.equal(cursorId(document), "area:otto/tangent");
  press(window, "}", { shiftKey: true });
  await settle(window);
  assert.equal(cursorId(document), "area:otto/tangent", "no wrap and no hidden sub-header");
});

test("the caption on a header teaches { } beside fold, from the one key table", async () => {
  const { window, document } = await bootWorkTable(subAreaFixture(), { workFilter: "all" });
  await clickRow(window, document.querySelector(`tr[data-work-sub-area='${WORK}']`));
  const hint = document.querySelector(".work-keyboard-hint");
  assert.equal(hint.dataset.workCaptionRow, "area", "a sub-header is an Area row");
  assert.match(hint.textContent, /h\/l fold · \{ \} areas/);
  const entry = workCaptionKeys("area").find((item) => item.word === "areas");
  assert.deepEqual(entry.ids, ["previousArea", "nextArea"]);
  assert.equal(entry.keyDisplay, "{ }");
});

test("b, a, and : on a sub-header act on that Area, and h/l walk one level deeper", async () => {
  const { window, document } = await bootWorkTable(subAreaFixture(), { workFilter: "all" });
  /** The Work sub-header as painted now. */
  const workHeader = () => document.querySelector(`tr[data-work-sub-area='${WORK}']`);
  await clickRow(window, workHeader());
  press(window, ":", { shiftKey: true });
  await settle(window);
  assert.match(document.querySelector("#modal-title").textContent, /Shell \/ Work/, "the : menu names the sub-Area");
  assert.ok(document.querySelector("[data-modal-action='openBrain']"), "the menu holds the Area commands");
  press(window, "Escape");
  await settle(window);

  await clickRow(window, workHeader());
  press(window, "b");
  await settle(window);
  const popover = document.querySelector("[data-launch-popover]");
  assert.ok(popover, "b on a sub-Area with no brain opens the composer that starts one");
  assert.match(popover.querySelector("header").textContent, /Otto \/ Tangent \/ Shell \/ Work/, "the composer is for the sub-Area, not its parent");
  document.querySelector("[data-launch-close]").click();
  await settle(window);

  // h on a Goal under a sub-header goes to that sub-header, h on the open
  // sub-header folds it, h on the folded sub-header goes to the top level.
  const workGoal = document.querySelector(`tr[data-work-area='${WORK}'][data-goal-anchor]`);
  await clickRow(window, workGoal);
  press(window, "h");
  await settle(window);
  assert.equal(cursorId(document), `area:${WORK}`, "h on a Goal moves to its sub-header");
  press(window, "h");
  await settle(window);
  assert.equal(workHeader().querySelector(".work-fold").textContent, "▸", "h on an open sub-header folds it");
  assert.equal(cursorId(document), `area:${WORK}`);
  press(window, "h");
  await settle(window);
  assert.equal(cursorId(document), "area:otto/tangent", "h on a folded sub-header goes to the top-level header");
  press(window, "l");
  await settle(window);
  assert.equal(cursorId(document), "goal:otto/tangent/goal-inconsistencies.md", "l on the open top-level header enters its first own Goal");
  await clickRow(window, workHeader());
  press(window, "l");
  await settle(window);
  assert.equal(workHeader().querySelector(".work-fold").textContent, "▾", "l unfolds the sub-header");
  press(window, "l");
  await settle(window);
  assert.equal(cursorId(document), `goal:${WORK}/goal-work-rows.md`, "l again enters its first Goal");

  await clickRow(window, workHeader());
  press(window, "a");
  await settle(window);
  assert.equal(document.querySelector("#describe-area").value, WORK, "a messages the sub-Area brain");
});

test("every not-done Area has a row: a quiet top-level Area, a quiet sub-Area, and a deep live brain", async () => {
  const { window, document } = await bootWorkTable(rootedFixture(), { workFilter: "all" });
  assert.deepEqual([...document.querySelectorAll("tbody[data-work-group]")].map((body) => body.dataset.workGroup), ["otto", "personal"], "one row group per top-level Area, no sub-Area is a peer group");

  const personal = document.querySelector("tbody[data-work-group='personal']");
  const personalHeader = personal.querySelector(".work-group-row");
  assert.equal(personalHeader.querySelector(".work-group-count").textContent, "0 open", "a top-level Area with nothing under it keeps its header");
  assert.equal(personalHeader.querySelector(".work-group-brain").dataset.brainVerb, "Start brain");
  assert.equal(personalHeader.querySelector(".work-group-brain kbd").textContent, "b");
  assert.equal(personal.querySelectorAll("tr").length, 1, "and nothing under it");

  const otto = document.querySelector("tbody[data-work-group='otto']");
  const subHeaders = [...otto.querySelectorAll("tr[data-work-sub-area]")];
  assert.deepEqual(subHeaders.map((row) => row.dataset.workSubArea), ["otto/onboarding", "otto/standards", "otto/tangent", "otto/tangent/notes", SHELL, WORK, KEYS], "every sub-Area is a sub-header in path order");
  assert.match(otto.querySelector(".work-group-row .work-group-count").textContent, /^11 open/, "the top-level count sums every sub-Area");

  const notes = subHeaders[3];
  assert.ok(notes.classList.contains("quiet"), "a sub-Area with no work, no live brain, and no question is the muted row");
  assert.equal(notes.querySelector(".work-group-count").textContent, "0 open");
  assert.equal(notes.querySelector(".desk-state"), null, "no state on a quiet row");
  assert.ok(notes.querySelector(".work-fold"), "it keeps its fold triangle");
  assert.equal(notes.querySelector(".work-group-brain").dataset.brainVerb, "Start brain");
  assert.equal(notes.querySelector(".work-group-brain kbd").textContent, "b");
  assert.equal(notes.querySelector(".desk-action-menu-trigger kbd").textContent, ":");
  assert.equal(subHeaders.filter((row) => row.classList.contains("quiet")).length, 1, "a sub-Area with work is not muted");

  const shell = subHeaders.find((row) => row.dataset.workSubArea === SHELL);
  assert.equal(shell.querySelector(".work-group-brain").dataset.brainVerb, "Open brain", "a live brain at depth 3 is a sub-header inside its top-level group");
  assert.match(shell.querySelector(".desk-state").textContent, /Brain working/);

  // } walks every header, the quiet ones included, and b on the quiet row
  // starts its brain.
  await clickRow(window, document.querySelector("tr[data-work-sub-area='otto/tangent']"));
  const steps = [];
  for (let index = 0; index < 5; index += 1) {
    press(window, "}", { shiftKey: true });
    await settle(window);
    steps.push(cursorId(document));
  }
  assert.deepEqual(steps, ["area:otto/tangent/notes", `area:${SHELL}`, `area:${WORK}`, `area:${KEYS}`, "area:personal"], "} visits the quiet sub-header and the quiet top-level header");
  await clickRow(window, document.querySelector("tr[data-work-sub-area='otto/tangent/notes']"));
  press(window, "b");
  await settle(window);
  const popover = document.querySelector("[data-launch-popover]");
  assert.ok(popover, "b on a quiet sub-Area opens the composer that starts its brain");
  assert.match(popover.querySelector("header").textContent, /Notes/);
});

const DND = "otto/dnd";
const DIALOGUE = "otto/dnd/dialogue";
const PLAYERS = "otto/dnd/players";

/**
 * Julian's bug: `otto/dnd` above `otto/dnd/dialogue` and `otto/dnd/players`,
 * with a brain asking on Players. Folding D&D left the deeper rows showing.
 */
function dndFixture() {
  const fixture = rootedFixture();
  const dndGoal = goal(DND, "campaign", "Plan the campaign");
  const dialogueGoal = goal(DIALOGUE, "voices", "Write the voices");
  const playersGoal = goal(PLAYERS, "roster", "Fill the roster");
  const areas = [
    { path: DND, name: "dnd", goals: [dndGoal], documents: [] },
    { path: DIALOGUE, name: "dialogue", goals: [dialogueGoal], documents: [] },
    { path: PLAYERS, name: "players", goals: [playersGoal], documents: [] },
  ];
  fixture.goals.push(dndGoal, dialogueGoal, playersGoal);
  fixture.vault.areas.push(...areas);
  fixture.vault.map.push(...areas.map((area) => ({ path: area.path, name: area.name, goals: area.goals })));
  fixture.brains.push({
    area: PLAYERS, status: "active", live: false, session: "otto-dnd-players--brain", generation: 1, forJulian: [],
    requests: [{ id: "req-players", status: "open", kind: "decision", subject: "Which roster?", question: "Which roster size?" }],
  });
  return fixture;
}

test("folding a sub-Area hides its deeper sub-Areas and their Goals, and its row rolls up what it hides", async () => {
  const { window, document } = await bootWorkTable(dndFixture(), { workFilter: "all" });
  /** One sub-header as painted now. */
  const header = (path) => document.querySelector(`tr[data-work-sub-area='${path}']`);
  assert.deepEqual([DND, DIALOGUE, PLAYERS].map((path) => header(path).querySelector(".work-group-count").textContent), ["1 open", "1 open", "1 open · 1 blocker · 1 question"], "open, every sub-header counts only its own work");
  assert.equal(header(DND).querySelector(".desk-state"), null, "open, D&D does not show the Players question");

  // Players is folded first, so its own fold state has something to keep.
  header(PLAYERS).querySelector(".work-fold").click();
  await settle(window);
  header(DND).querySelector(".work-fold").click();
  await settle(window);
  assert.equal(header(DND).querySelector(".work-fold").textContent, "▸");
  assert.equal(header(DIALOGUE), null, "the Dialogue row is hidden under folded D&D");
  assert.equal(header(PLAYERS), null, "the Players row is hidden under folded D&D");
  for (const path of [DND, DIALOGUE, PLAYERS]) assert.equal(document.querySelector(`tr[data-work-area='${path}'][data-goal-anchor]`), null, `no Goal of ${path} is a row`);
  assert.equal(header(DND).querySelector(".work-group-count").textContent, "3 open · 1 blocker · 1 question", "folded, D&D counts its subtree");
  const asking = header(DND).querySelector(".desk-state");
  assert.ok(asking?.classList.contains("waiting"), "folded, D&D shows the amber question pill of its descendant brain");
  assert.match(asking.textContent, /1 question/);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("agent-shell.folded-work-areas")), [PLAYERS, DND], "the hidden fold state stays in the store");
  assert.ok(header("otto/onboarding"), "a sibling sub-Area stays visible");

  // } from folded D&D goes to the next visible header after the hidden subtree.
  await clickRow(window, header(DND));
  press(window, "}", { shiftKey: true });
  await settle(window);
  assert.equal(cursorId(document), "area:otto/onboarding");
  press(window, "{", { shiftKey: true });
  await settle(window);
  assert.equal(cursorId(document), `area:${DND}`);
  press(window, "j");
  await settle(window);
  assert.equal(cursorId(document), "area:otto/onboarding", "j skips the hidden rows too");

  header(DND).querySelector(".work-fold").click();
  await settle(window);
  assert.equal(header(DND).querySelector(".work-group-count").textContent, "1 open", "open again, D&D counts only its own work");
  assert.equal(header(DND).querySelector(".desk-state"), null);
  assert.equal(header(DIALOGUE).querySelector(".work-fold").textContent, "▾", "Dialogue comes back open");
  assert.ok(document.querySelector(`tr[data-work-area='${DIALOGUE}'][data-goal-anchor]`));
  assert.equal(header(PLAYERS).querySelector(".work-fold").textContent, "▸", "Players comes back with its own stored fold");
  assert.equal(document.querySelector(`tr[data-work-area='${PLAYERS}'][data-goal-anchor]`), null);
  assert.equal(header(PLAYERS).querySelector(".work-group-count").textContent, "1 open · 1 blocker · 1 question");
});
