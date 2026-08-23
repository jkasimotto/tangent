import assert from "node:assert/strict";
import test from "node:test";
import { fencedLineFlags, markdownHeadings, markdownTableAlignments, markdownTableCells } from "./public/markdown-structure.js";

test("Markdown headings ignore fenced lookalikes and retain source lines", () => {
  const text = "---\ntype: document\n---\n# Real\n```js\n# Not heading\n```\n## Next";
  assert.deepEqual(markdownHeadings(text), [
    { level: 1, title: "Real", id: "real", line: 3 },
    { level: 2, title: "Next", id: "next", line: 7 },
  ]);
  assert.deepEqual(fencedLineFlags(["before", "```", "inside", "```", "after"]), [false, true, true, true, false]);
});

test("Markdown table structure handles escapes and alignment", () => {
  assert.deepEqual(markdownTableCells("| one \\| two | three |"), ["one | two", "three"]);
  assert.deepEqual(markdownTableAlignments("| :--- | ---: |"), ["left", "right"]);
  assert.equal(markdownTableAlignments("not a separator"), null);
});
