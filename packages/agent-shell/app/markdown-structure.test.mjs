import assert from "node:assert/strict";
import test from "node:test";
import { fencedLineFlags, markdownHeadings, markdownTableAlignments, markdownTableCells, scanMarkdownBlocks } from "./public/markdown-structure.js";

test("Markdown headings ignore fenced lookalikes and retain source lines", () => {
  const text = "---\ntype: document\n---\n# Real\n```js\n# Not heading\n```\n## Next";
  assert.deepEqual(markdownHeadings(text), [
    { level: 1, title: "Real", id: "real", line: 3 },
    { level: 2, title: "Next", id: "next", line: 7 },
  ]);
  assert.deepEqual(fencedLineFlags(["before", "```", "inside", "```", "after"]), [false, true, true, true, false]);
});

test("the shared block scan retains stable source boundaries for structured copy", () => {
  const blocks = scanMarkdownBlocks("---\ntype: document\n---\n# Title\n\n- Item\n\n```js\none\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
  assert.deepEqual(blocks.map(({ id, type, firstLine, lastLine }) => ({ id, type, firstLine, lastLine })), [
    { id: "0", type: "heading", firstLine: 3, lastLine: 3 },
    { id: "1", type: "list", firstLine: 5, lastLine: 5 },
    { id: "2", type: "code", firstLine: 7, lastLine: 9 },
    { id: "3", type: "table", firstLine: 11, lastLine: 13 },
  ]);
  assert.equal(blocks[2].detail.language, "js");
  assert.deepEqual(blocks[3].detail.rows, [["A", "B"], ["1", "2"]]);
});

test("Markdown table structure handles escapes and alignment", () => {
  assert.deepEqual(markdownTableCells("| one \\| two | three |"), ["one | two", "three"]);
  assert.deepEqual(markdownTableAlignments("| :--- | ---: |"), ["left", "right"]);
  assert.equal(markdownTableAlignments("not a separator"), null);
});
