import assert from "node:assert/strict";
import test from "node:test";

import { diffLines } from "../dist/server/diff.js";

test("diffs a small edit and reports correct kinds and line numbers", () => {
  const left = "a\nb\nc\n";
  const right = "a\nB\nc\n";
  const rows = diffLines(left, right);
  assert.deepEqual(rows.map((row) => row.kind), ["equal", "changed", "equal"]);
  const changed = rows[1];
  assert.equal(changed.leftNumber, 2);
  assert.equal(changed.rightNumber, 2);
  assert.equal(changed.left, "b");
  assert.equal(changed.right, "B");
});

test("treats a brand-new file as all additions", () => {
  const rows = diffLines("", "x\ny\n");
  assert.deepEqual(rows.map((row) => row.kind), ["add", "add"]);
  assert.deepEqual(rows.map((row) => row.rightNumber), [1, 2]);
});

test("preserves absolute line numbers after trimming the common prefix and suffix", () => {
  const left = ["1", "2", "3", "4", "5"].join("\n") + "\n";
  const right = ["1", "2", "INSERTED", "3", "4", "5"].join("\n") + "\n";
  const rows = diffLines(left, right);
  const added = rows.find((row) => row.kind === "add");
  assert.equal(added.right, "INSERTED");
  assert.equal(added.rightNumber, 3);
  // The trailing lines keep their real (shifted) numbers on each side.
  const lastEqual = rows.filter((row) => row.kind === "equal").at(-1);
  assert.equal(lastEqual.left, "5");
  assert.equal(lastEqual.leftNumber, 5);
  assert.equal(lastEqual.rightNumber, 6);
});

test("diffs a tiny edit in a very large file quickly (prefix/suffix trimming, not O(n*m))", () => {
  const base = Array.from({ length: 8000 }, (_unused, index) => `line ${index}`);
  const edited = base.slice();
  edited.splice(4000, 0, "the one inserted line");
  const start = process.hrtime.bigint();
  const rows = diffLines(base.join("\n") + "\n", edited.join("\n") + "\n");
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(rows.some((row) => row.kind === "add" && row.right === "the one inserted line"));
  assert.ok(elapsedMs < 300, `diff of an 8000-line file took ${elapsedMs.toFixed(0)}ms, expected < 300ms`);
});
