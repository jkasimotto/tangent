import assert from "node:assert/strict";
import test from "node:test";
import { cleanText, clip, escapeHtml, progressPoints } from "./public/text-format.js";

test("text formatting escapes HTML and removes display Markdown", () => {
  assert.equal(escapeHtml('<a x="1">&</a>'), "&lt;a x=&quot;1&quot;&gt;&amp;&lt;/a&gt;");
  assert.equal(cleanText("## **See** [[note|Note]] and `code`"), "See note|Note and code");
});

test("text formatting clips on words and summarizes progress", () => {
  assert.match(clip("one two three four five", 15), /…$/);
  assert.deepEqual(progressPoints("- First\n\n- Second"), ["First", "Second"]);
  assert.deepEqual(progressPoints(""), ["No progress note exists yet."]);
});
