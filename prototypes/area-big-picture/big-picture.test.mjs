import assert from "node:assert/strict";
import test from "node:test";
import { actionsFor, back, childRows, cursorRow, handleKey, initialState, pictureRows, relationGraph, runAction, sendComposer, top, verbsFor } from "./big-picture.mjs";

/** Run a space-separated key sequence. */
function press(state, keys) {
  return keys.split(" ").reduce((s, k) => handleKey(s, k), state);
}

test("show me Neara: needs-you children first, then waiting, then no-brain fallback rows", () => {
  const rows = childRows("neara");
  assert.deepEqual(rows.map((r) => r.signal), ["needs you", "needs you", "needs you", "needs you", "needs you", "no brain", "no brain"]);
  assert.deepEqual(rows.slice(0, 5).map((r) => r.name), ["PG&E", "Portland", "Delivery", "Essential / Autodesign", "Enums"]);
  assert.equal(rows[3].passedThrough, true, "a brainless Area passes its strongest child's line through");
});

test("a Check it Goal shows as needs you without any brain (Tangent fact, section 10.1)", () => {
  const delivery = childRows("neara").find((r) => r.name === "Delivery");
  assert.equal(delivery.fallback, true);
  assert.match(delivery.next, /Check it: Lint reserved field names · D100199/);
});

test("an outcome from the brain's own words carries the not-in-a-note mark and a deadline in words", () => {
  const portland = childRows("neara").find((r) => r.name === "Portland");
  assert.equal(portland.source, "brain");
  assert.equal(portland.by.words, "before Monday US time");
});

test("Enter drills into a child, Escape returns with the parent's cursor kept", () => {
  const state = press(initialState("neara"), "j j j j");
  const row = cursorRow(state);
  assert.equal(row.kind, "child");
  const inside = handleKey(state, "Enter");
  assert.equal(top(inside).areaId, row.areaId);
  assert.equal(inside.stack.length, 2);
  const out = handleKey(inside, "Escape");
  assert.equal(top(out).cursor, 4);
});

test("Enter on an option approves it with one press and marks it waiting for the brain", () => {
  const state = press(initialState("neara"), "j j");
  const row = cursorRow(state);
  assert.equal(row.kind, "option");
  const approved = handleKey(state, "Enter");
  assert.equal(approved.pending[row.id], "approved · waiting for the brain");
  assert.match(approved.log.at(-1), /Julian approved: Send Sami and Sahan/);
});

test("correct never edits the element; it sends the brain a correction and marks the row", () => {
  const state = handleKey(initialState("neara"), "c");
  assert.equal(state.layer.kind, "compose");
  assert.match(state.layer.text, /^Correction on "Ship what PG&E/);
  const sent = sendComposer(state);
  assert.equal(sent.pending["outcome:neara-1"], "correction sent · waiting for the brain");
  assert.match(sent.log.at(-1), /\(correction\)/);
  assert.equal(cursorRow(sent).outcome.outcome, "Ship what PG&E is waiting on this week");
});

test("actions offer Do it first when Julian holds the move, and a nudge when someone else does", () => {
  const julian = cursorRow(initialState("neara"));
  assert.equal(actionsFor({ kind: "outcome", areaId: "neara", outcome: julian.outcome })[0][1], `Do it: ${julian.outcome.next}`);
  const neil = pictureRows("neara/portland")[1];
  assert.equal(actionsFor(neil)[0][1], "Message the brain: nudge Neil");
  const done = runAction({ ...initialState("neara"), layer: { kind: "actions", row: julian, choice: 0 } }, "do");
  assert.match(done.log.at(-1), /open cdev tab/);
});

test("relations view draws cross-Area edges from declared relations only", () => {
  const { nodes, edges } = relationGraph("neara");
  const sameAs = edges.filter((e) => e.kind === "same as");
  assert.equal(sameAs.length, 2, "pole diff and structure diff point at each other");
  assert.ok(edges.some((e) => e.kind === "feeds" && e.label === "Land the megabranch"));
  assert.ok(nodes.every((n) => n.outcome));
  const view = handleKey(initialState("neara"), "g");
  assert.equal(view.view, "relations");
  assert.equal(handleKey(view, "Escape").view, "list");
});

test("a child with its own brain wins; the parent's disagreeing signal shows dim beside it", () => {
  const standards = childRows("neara/pgande").find((r) => r.name === "Standards");
  assert.equal(standards.signal, "moving");
  assert.deepEqual(standards.parentSays, { signal: "waiting on", who: "Neil" });
});

test("a no-brain child offers Start brain and not ask or correct", () => {
  const hedno = pictureRows("neara").find((r) => r.kind === "child" && r.child.name === "Hedno");
  assert.equal(hedno.child.next, "nothing here");
  assert.deepEqual(verbsFor(hedno).map(([k]) => k), ["Enter", "s", "o"]);
  const state = { ...initialState("neara"), stack: [{ areaId: "neara", cursor: pictureRows("neara").findIndex((r) => r.id === hedno.id), expanded: new Set() }] };
  assert.match(handleKey(state, "s").log.at(-1), /tangent brain start neara\/hedno/);
});

test("Escape on the root picture goes back to Work", () => {
  assert.match(back(initialState("neara")).log.at(-1), /back to Work/);
});
