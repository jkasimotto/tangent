import assert from "node:assert/strict";
import test from "node:test";
import { applyVerb, back, cursorRow, goToRows, handleListKey, initialState, revealPath, setCursor, verbsFor, visibleRows } from "./navigation-model.mjs";

/** Run a key sequence through the list dispatcher. */
function press(state, keys) {
  return keys.split(" ").reduce((current, key) => handleListKey(current, key).state, state);
}

test("assignment and attempt rows are cursor-addressable under an expanded Goal", () => {
  const state = initialState();
  const kinds = visibleRows(state.tree, state.expanded).map((row) => row.kind);
  assert.ok(kinds.includes("assignment"));
  const step = press(state, "j j j");
  assert.equal(cursorRow(step).kind, "assignment");
  assert.equal(cursorRow(press(step, "j l j")).kind, "attempt");
});

test("j/k, arrows, and clicks move the same cursor", () => {
  const state = initialState();
  assert.equal(press(state, "j j").cursor, press(state, "ArrowDown ArrowDown").cursor);
  const target = "goal:otto/tangent/goal-compact-work-refresh.md";
  const index = visibleRows(state.tree, state.expanded).findIndex((row) => row.id === target);
  const clicked = setCursor(state, target);
  assert.equal(press(clicked, "j").cursor, press(state, Array(index + 1).fill("j").join(" ")).cursor);
});

test("h and l collapse, expand, and walk parent or child", () => {
  const goal = press(initialState(), "j j");
  assert.equal(cursorRow(goal).kind, "goal");
  const collapsed = press(goal, "h");
  assert.equal(cursorRow(collapsed).expanded, false);
  assert.equal(cursorRow(press(collapsed, "h")).kind, "area");
  assert.equal(cursorRow(press(collapsed, "l l")).kind, "assignment");
});

test("gg, G, and Area jumps use one chord engine", () => {
  const state = press(initialState(), "G");
  assert.equal(cursorRow(state).title, "Autodesign poles");
  assert.equal(press(state, "g g").cursor, "area:otto/tangent");
  assert.equal(press(state, "g j").cursor, state.cursor, "a broken chord falls through to j at the last row");
  assert.equal(press(initialState(), "}").cursor, "area:neara/pgande");
});

test("Enter opens the live session on any level, else the editor; Back restores the opener", () => {
  const goal = press(initialState(), "j j");
  const entered = handleListKey(goal, "Enter");
  assert.match(entered.log, /tangent-worker-nav-2/);
  assert.equal(back(entered.state).cursor, goal.cursor);
  const openGoal = setCursor(goal, "goal:otto/tangent/goal-compact-work-refresh.md");
  assert.match(handleListKey(openGoal, "Enter").log, /launch editor/);
  const brain = press(initialState(), "j");
  assert.match(handleListKey(brain, "Enter").log, /tangent-brain-g327/);
});

test("stop and restart are x choices on assignment and attempt rows", () => {
  const assignment = press(initialState(), "j j j j");
  assert.equal(cursorRow(assignment).kind, "assignment");
  const choices = applyVerb(assignment, "status").state.layers.at(-1).choices.map(([, label]) => label);
  assert.deepEqual(choices, ["Skip", "End"]);
  const attempt = press(assignment, "l j j");
  assert.equal(cursorRow(attempt).kind, "attempt");
  const ended = applyVerb(applyVerb(attempt, "status").state, "status", "c");
  assert.match(ended.log, /Change the agent/);
  assert.equal(ended.state.layers.length, 0);
});

test("generic verbs stay identical across kinds and the key sheet derives from the matrix", () => {
  const state = initialState();
  for (const row of visibleRows(state.tree, state.expanded)) {
    const keys = verbsFor(row).map((verb) => verb.key);
    assert.deepEqual(keys.filter((key) => ["Enter", "o", ":"].includes(key)), ["Enter", "o", ":"], row.kind);
  }
  assert.equal(handleListKey(state, "?").state.layers.at(-1).verbs.length, verbsFor(cursorRow(state)).length);
});

test("Go To lists sessions and assignments, ranks live rows first, and reveals the target", () => {
  const state = initialState();
  const rows = goToRows(state.tree, "nav-2");
  assert.equal(rows[0].session, "tangent-worker-nav-2");
  assert.ok(goToRows(state.tree).some((row) => row.kind === "assignment"));
  const collapsed = press(state, "j j h");
  const revealed = revealPath(collapsed, "attempt:navigation-model#2/2");
  assert.equal(cursorRow(revealed)?.kind, "attempt");
});
