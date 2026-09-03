import { strict as assert } from "node:assert";
import { test } from "node:test";
import { count, index } from "../units/units.ts";
import { isRovingKey, rovingTarget, tabStop } from "./listbox-roving.ts";

const FIVE = count(5);

test("only the four roving keys move focus", () => {
  assert.equal(isRovingKey("ArrowDown"), true);
  assert.equal(isRovingKey("ArrowUp"), true);
  assert.equal(isRovingKey("Home"), true);
  assert.equal(isRovingKey("End"), true);
  assert.equal(isRovingKey("Enter"), false);
  assert.equal(isRovingKey("Escape"), false);
});

test("the tab stop is the selected option, else the first, else nothing", () => {
  assert.equal(tabStop(index(3), FIVE), 3);
  assert.equal(tabStop(null, FIVE), 0);
  assert.equal(tabStop(index(9), FIVE), 4);
  assert.equal(tabStop(null, count(0)), null);
  assert.equal(tabStop(index(0), count(0)), null);
});

test("arrows step by one and clamp at the ends", () => {
  assert.equal(rovingTarget(index(0), FIVE, "ArrowDown"), 1);
  assert.equal(rovingTarget(index(4), FIVE, "ArrowDown"), 4);
  assert.equal(rovingTarget(index(1), FIVE, "ArrowUp"), 0);
  assert.equal(rovingTarget(index(0), FIVE, "ArrowUp"), 0);
});

test("Home and End jump to the ends", () => {
  assert.equal(rovingTarget(index(3), FIVE, "Home"), 0);
  assert.equal(rovingTarget(index(1), FIVE, "End"), 4);
  assert.equal(rovingTarget(index(0), count(1), "End"), 0);
});

test("every option is reachable from the first by ArrowDown alone", () => {
  const reached: Array<ReturnType<typeof index>> = [index(0)];
  let current = index(0);
  while (reached.length < FIVE) {
    current = rovingTarget(current, FIVE, "ArrowDown");
    reached.push(current);
  }
  assert.deepEqual(reached, [0, 1, 2, 3, 4]);
});
