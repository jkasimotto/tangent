import { strict as assert } from "node:assert";
import { test } from "node:test";
import { point, rect } from "../../units/frames.ts";
import { areaKey } from "../../units/ids.ts";
import { scenePx } from "../../units/units.ts";
import { EMPTY_PICKER_STATE, isPickerOpen, pickerReducer, pickerTarget } from "./picker-store.ts";
import type { PickerState, PickerTarget } from "./picker-store.ts";

const TARGET: PickerTarget = { area: areaKey("otto"), point: point("scene", scenePx(10), scenePx(20)), outside: false, dock: "right" };

/** Opens the picker from the empty state. */
function opened(): PickerState {
  return pickerReducer(EMPTY_PICKER_STATE, { kind: "open", target: TARGET });
}

test("open sets the target and resets the query and the wide switch, keeping search results", () => {
  const wide = pickerReducer(pickerReducer(opened(), { kind: "toggle-wide" }), { kind: "set-query", query: "goal" });
  const withEntities = pickerReducer(wide, { kind: "set-entities", entities: [{ file: "otto/goal.md", kind: "goal" }] });
  const reopened = pickerReducer(withEntities, { kind: "open", target: TARGET });
  assert.equal(isPickerOpen(EMPTY_PICKER_STATE), false);
  assert.equal(isPickerOpen(reopened), true);
  assert.deepEqual([reopened.query, reopened.wide, reopened.entities.length], ["", false, 1]);
});

test("close clears the target and the query and is a no-op when already closed", () => {
  const closed = pickerReducer(pickerReducer(opened(), { kind: "set-query", query: "x" }), { kind: "close" });
  assert.deepEqual([closed.target, closed.query], [null, ""]);
  assert.equal(pickerReducer(EMPTY_PICKER_STATE, { kind: "close" }), EMPTY_PICKER_STATE);
});

test("set-query returns the same state for the same text and toggle-wide flips", () => {
  const state = pickerReducer(opened(), { kind: "set-query", query: "a" });
  assert.equal(pickerReducer(state, { kind: "set-query", query: "a" }), state);
  assert.equal(pickerReducer(state, { kind: "toggle-wide" }).wide, true);
  assert.equal(pickerReducer(pickerReducer(state, { kind: "toggle-wide" }), { kind: "toggle-wide" }).wide, false);
});

test("placed clears the query and closes unless the person asked to place another", () => {
  const typed = pickerReducer(opened(), { kind: "set-query", query: "goal" });
  const kept = pickerReducer(typed, { kind: "placed", keepOpen: true });
  assert.deepEqual([kept.target, kept.query], [TARGET, ""]);
  const closed = pickerReducer(typed, { kind: "placed", keepOpen: false });
  assert.deepEqual([closed.target, closed.query], [null, ""]);
});

test("pickerTarget says outside when no region holds the point and docks away from the pointer", () => {
  const regions = [rect("scene", scenePx(0), scenePx(0), scenePx(100), scenePx(100))];
  const centre = point("scene", scenePx(500), scenePx(500));
  const inside = pickerTarget({ area: areaKey("otto"), point: point("scene", scenePx(50), scenePx(50)) }, regions, centre);
  assert.deepEqual([inside.outside, inside.dock], [false, "right"]);
  const edge = pickerTarget({ area: areaKey("otto"), point: point("scene", scenePx(100), scenePx(100)) }, regions, centre);
  assert.equal(edge.outside, false);
  const outside = pickerTarget({ area: areaKey("otto"), point: point("scene", scenePx(900), scenePx(50)) }, regions, centre);
  assert.deepEqual([outside.outside, outside.dock], [true, "left"]);
  assert.deepEqual(pickerTarget({ area: areaKey("otto"), point: point("scene", scenePx(500), scenePx(0)) }, [], centre).dock, "left");
});
