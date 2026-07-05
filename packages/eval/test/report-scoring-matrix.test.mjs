import assert from "node:assert/strict";
import test from "node:test";

import { buildScoringMatrix } from "../dist/report/model.js";

/** Builds a scoring-matrix entry with the given per-criterion pass/fail verdicts. */
function entry(key, verdicts) {
  return {
    key,
    evaluation: {
      criteria: Object.entries(verdicts).map(([id, passed]) => ({ id, statement: `statement-${id}`, passed, reasoning: `reasoning-${id}` }))
    }
  };
}

test("buildScoringMatrix builds one row per criterion across N columns, in first-seen order", () => {
  const criteria = buildScoringMatrix([
    entry("a", { x: true, y: true }),
    entry("b", { x: true, y: false }),
    entry("c", { x: true, y: true })
  ]);
  assert.deepEqual(criteria.map((criterion) => criterion.id), ["y", "x"], "discriminating y floats above unanimous x");
  const yRow = criteria.find((criterion) => criterion.id === "y");
  assert.deepEqual(yRow.cells.map((cell) => [cell.variantKey, cell.passed]), [["a", true], ["b", false], ["c", true]]);
});

test("buildScoringMatrix sorts discriminating criteria first across more than two columns", () => {
  const criteria = buildScoringMatrix([
    entry("baseline", { unanimous: true, split: true }),
    entry("v2", { unanimous: true, split: false }),
    entry("v3", { unanimous: true, split: true }),
    entry("v4", { unanimous: true, split: false })
  ]);
  assert.equal(criteria[0].id, "split");
  assert.equal(criteria[0].discriminating, true);
  assert.equal(criteria[1].id, "unanimous");
  assert.equal(criteria[1].discriminating, false);
});

test("buildScoringMatrix leaves a cell's passed undefined when a column has no evaluation, without marking the row discriminating on that basis alone", () => {
  const criteria = buildScoringMatrix([
    entry("a", { x: true }),
    { key: "b", evaluation: undefined }
  ]);
  const row = criteria.find((criterion) => criterion.id === "x");
  const bCell = row.cells.find((cell) => cell.variantKey === "b");
  assert.equal(bCell.passed, undefined);
  // Only one column has a known verdict, so nothing can disagree.
  assert.equal(row.discriminating, false);
});

test("buildScoringMatrix keeps a stable original order for ties (Array.sort is stable)", () => {
  const criteria = buildScoringMatrix([entry("a", { first: true, second: true, third: true })]);
  assert.deepEqual(criteria.map((criterion) => criterion.id), ["first", "second", "third"]);
});
