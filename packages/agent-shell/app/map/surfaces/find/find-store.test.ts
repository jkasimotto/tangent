import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { CapturedView } from "../../kernel/kernel-types.ts";
import { areaKey } from "../../units/ids.ts";
import { count, index, scenePx, zoom } from "../../units/units.ts";
import { EMPTY_FIND_STATE, activeFindIndex, activeFindRow, findReducer, findWindow, steppedFindIndex } from "./find-store.ts";
import type { FindState } from "./find-store.ts";

const ORIGIN: CapturedView = {
  camera: { scrollX: scenePx(10), scrollY: scenePx(20), zoom: zoom(1) },
  locatedArea: areaKey("otto"),
  cameraTarget: null,
  cameraTrail: [],
  restrictionArea: null,
  selection: [],
  findRevealId: null,
};

/** Opens Find from the empty state. */
function opened(): FindState {
  return findReducer(EMPTY_FIND_STATE, { kind: "open", origin: ORIGIN });
}

test("open records the origin once and keeps it on a second open", () => {
  const state = opened();
  assert.equal(state.open, true);
  assert.equal(state.kept, true);
  assert.equal(state.origin, ORIGIN);
  const other = { ...ORIGIN, locatedArea: areaKey("neara") };
  const again = findReducer(state, { kind: "open", origin: other });
  assert.equal(again, state);
});

test("set-query resets the position and keeps the match only when something matched", () => {
  const hit = findReducer(opened(), { kind: "set-query", query: "otto", total: count(3) });
  assert.deepEqual([hit.query, hit.index, hit.kept], ["otto", 0, true]);
  const miss = findReducer(hit, { kind: "set-query", query: "zzz", total: count(0) });
  assert.deepEqual([miss.query, miss.index, miss.kept], ["zzz", 0, false]);
});

test("step wraps at both ends and does nothing with no rows", () => {
  let state = findReducer(opened(), { kind: "set-query", query: "o", total: count(3) });
  state = findReducer(state, { kind: "step", direction: "previous", total: count(3) });
  assert.equal(state.index, 2);
  state = findReducer(state, { kind: "step", direction: "next", total: count(3) });
  assert.equal(state.index, 0);
  assert.equal(findReducer(state, { kind: "step", direction: "next", total: count(0) }), state);
});

test("select moves to a row and keeps it", () => {
  const state = findReducer(findReducer(opened(), { kind: "set-query", query: "o", total: count(0) }), { kind: "select", position: index(2) });
  assert.equal(state.index, 2);
  assert.equal(state.kept, true);
});

test("confirm closes and keeps the match, cancel closes and drops it, both forget the origin", () => {
  const confirmed = findReducer(opened(), { kind: "confirm" });
  assert.deepEqual([confirmed.open, confirmed.kept, confirmed.origin], [false, true, null]);
  const cancelled = findReducer(opened(), { kind: "cancel" });
  assert.deepEqual([cancelled.open, cancelled.kept, cancelled.origin], [false, false, null]);
});

test("activeFindIndex clamps a stale position into the rows found now", () => {
  assert.equal(activeFindIndex(index(7), count(3)), 2);
  assert.equal(activeFindIndex(index(1), count(3)), 1);
  assert.equal(activeFindIndex(index(4), count(0)), 0);
});

test("steppedFindIndex steps from the clamped position", () => {
  assert.equal(steppedFindIndex(index(9), "next", count(3)), 0);
  assert.equal(steppedFindIndex(index(0), "previous", count(3)), 2);
  assert.equal(steppedFindIndex(index(0), "next", count(0)), 0);
});

test("activeFindRow answers only while open or kept", () => {
  const rows = ["a", "b", "c"];
  assert.equal(activeFindRow(EMPTY_FIND_STATE, rows), null);
  assert.equal(activeFindRow(opened(), rows), "a");
  const stepped = findReducer(opened(), { kind: "select", position: index(2) });
  assert.equal(activeFindRow(findReducer(stepped, { kind: "confirm" }), rows), "c");
  assert.equal(activeFindRow(findReducer(stepped, { kind: "cancel" }), rows), null);
  assert.equal(activeFindRow(opened(), []), null);
});

test("findWindow keeps the active row in view and never runs past the ends", () => {
  assert.deepEqual(findWindow(index(0), count(3), count(8)), { start: 0, end: 3 });
  assert.deepEqual(findWindow(index(2), count(20), count(8)), { start: 0, end: 8 });
  assert.deepEqual(findWindow(index(9), count(20), count(8)), { start: 2, end: 10 });
  assert.deepEqual(findWindow(index(19), count(20), count(8)), { start: 12, end: 20 });
  assert.deepEqual(findWindow(index(0), count(0), count(8)), { start: 0, end: 0 });
});
