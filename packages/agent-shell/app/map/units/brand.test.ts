import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Brand } from "./brand.ts";

type Apples = Brand<number, "Apples">;
type Pears = Brand<number, "Pears">;

/** Accepts only apples, so the compiler proves pears cannot be passed. */
function takesApples(value: Apples): Apples {
  return value;
}

test("a brand is its base type at runtime", () => {
  const three = 3 as Apples;
  assert.equal(three, 3);
  assert.equal(typeof three, "number");
  assert.equal(takesApples(three), 3);
});

test("two brands of the same base type do not mix", () => {
  const pears = 2 as Pears;
  // @ts-expect-error a Pears is not an Apples even though both are numbers.
  takesApples(pears);
  // @ts-expect-error a raw number is not an Apples until it is branded.
  takesApples(2);
  assert.ok(true);
});
