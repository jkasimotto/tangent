// Two line shapes, and a Decide line must ask (design-the-for-you-row-shows-
// only-direct-asks, Decision 2). These tests pin the shapes, the aliases the
// live plans still use, the question rule, and what the section reports as
// not shown.

import test from "node:test";
import assert from "node:assert/strict";
import { forJulianSectionText, parseForJulian, removeForJulianLine, restoreForJulianLine, unparsedForJulianLines } from "./for-julian.mjs";

const PLAN = [
  "# Plan for otto/tangent",
  "",
  "## Waves",
  "",
  "- Decide [[design-not-listed]]: is this line in another section?",
  "",
  "## For Julian",
  "",
  "- Decide [[design-x]]: which of the 5 questions first? Unblocks: audit tier 4.",
  "- Test [[goal-find-a-document]]: press Cmd+K, type a title, press Enter.",
  "- Decide: should the audit cover the Usage UI too?",
  "",
  "## Later",
  "",
  "- nothing yet",
  "",
].join("\n");

test("parses the two line shapes, targeted and targetless, in order", () => {
  const rows = parseForJulian(PLAN);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.kind), ["decide", "test", "decide"]);
  assert.deepEqual(rows.map((row) => row.target), ["design-x", "find-a-document", null]);
  assert.deepEqual(rows.map((row) => row.index), [1, 2, 3]);
  assert.equal(rows[2].text, "should the audit cover the Usage UI too?");
  assert.deepEqual(unparsedForJulianLines(PLAN), [], "every line in the section is shown");
});

test("the old names still parse, so a live plan keeps working", () => {
  const rows = parseForJulian([
    "## For Julian",
    "",
    "- Decision [[design-x]]: which one?",
    "- Try it [[goal-find-a-document]]: press Cmd+K.",
    "- Brain: should the audit cover the Usage UI too?",
  ].join("\n"));
  assert.deepEqual(rows.map((row) => row.kind), ["decide", "test", "decide"]);
  assert.deepEqual(rows.map((row) => row.target), ["design-x", "find-a-document", null]);
});

test("a Decide line that states instead of asking is not a row", () => {
  const plan = [
    "## For Julian",
    "",
    "- Decide [[design-x]]: 5 questions.",
    "- Decision [[design-y]]: 3 questions. Unblocks: the audit.",
    "- Decide: I recommend the second option.",
    "- Brain: we should ship this.",
  ].join("\n");
  assert.deepEqual(parseForJulian(plan), []);
  assert.deepEqual(unparsedForJulianLines(plan).map((item) => item.index), [1, 2, 3, 4]);
});

test("a Test line needs no question mark: Tangent asks its question for it", () => {
  const rows = parseForJulian("## For Julian\n\n- Test [[goal-x]]: press Cmd+K, type a title.\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, "press Cmd+K, type a title.");
});

test("Unblocks splits off the ask, and the ask keeps its question mark", () => {
  const rows = parseForJulian("## For Julian\n\n- Decide [[design-x]]: which of the 5 questions first? Unblocks: audit tier 4.\n");
  assert.equal(rows[0].text, "which of the 5 questions first?");
  assert.equal(rows[0].unblocks, "audit tier 4");
});

test("a Decide line without Unblocks has unblocks null", () => {
  const rows = parseForJulian("## For Julian\n\n- Decide [[design-x]]: which one?\n");
  assert.equal(rows[0].text, "which one?");
  assert.equal(rows[0].unblocks, null);
});

test("a Test link with or without goal- gives the slug", () => {
  const rows = parseForJulian([
    "## For Julian",
    "",
    "- Test [[goal-find-a-document]]: press Cmd+K.",
    "- Test [[find-a-document]]: press Cmd+K.",
    "- Test [[goal-find-a-document.md|the finder]]: press Cmd+K.",
  ].join("\n"));
  assert.deepEqual(rows.map((row) => row.target), ["find-a-document", "find-a-document", "find-a-document"]);
});

test("ignores lines outside the section and lines in another shape", () => {
  const plan = [
    "## Waves",
    "",
    "- Decide [[design-elsewhere]]: is this shown?",
    "",
    "## For Julian",
    "",
    "- Idea: not a known shape.",
    "**Decide** [[design-x]]: does bold match?",
    "A plain paragraph.",
    "",
  ].join("\n");
  assert.deepEqual(parseForJulian(plan), []);
  assert.deepEqual(unparsedForJulianLines(plan).map((item) => item.line), ["- Idea: not a known shape.", "**Decide** [[design-x]]: does bold match?", "A plain paragraph."]);
});

test("a Test entry's continuation line is part of its row, not an unshown line", () => {
  const plan = [
    "## For Julian",
    "",
    "- Test [[goal-timeline]]: open the Tangent Area view.",
    "  Your rows now sit under the brain line; Read opens the Document.",
    "",
  ].join("\n");
  assert.equal(parseForJulian(plan).length, 1);
  assert.deepEqual(unparsedForJulianLines(plan), []);
});

test("returns [] when the section is absent", () => {
  assert.deepEqual(parseForJulian("# Plan\n\n## Waves\n\n- one\n"), []);
  assert.deepEqual(parseForJulian(""), []);
  assert.deepEqual(parseForJulian(null), []);
  assert.deepEqual(unparsedForJulianLines("# Plan\n\n## Waves\n\n- one\n"), []);
});

test("forJulianSectionText returns the section body, and \"\" when it is absent", () => {
  assert.equal(forJulianSectionText(PLAN), [
    "",
    "- Decide [[design-x]]: which of the 5 questions first? Unblocks: audit tier 4.",
    "- Test [[goal-find-a-document]]: press Cmd+K, type a title, press Enter.",
    "- Decide: should the audit cover the Usage UI too?",
    "",
  ].join("\n"));
  assert.equal(forJulianSectionText("# Plan\n\n## Waves\n\n- one\n"), "");
  assert.equal(forJulianSectionText(null), "");
});

test("removeForJulianLine removes only the first equal line and leaves the rest byte-for-byte", () => {
  const line = "- Test [[goal-find-a-document]]: press Cmd+K, type a title, press Enter.";
  const result = removeForJulianLine(PLAN, line);
  assert.equal(result.removed, true);
  assert.equal(result.index, 2);
  assert.equal(result.text, PLAN.split("\n").filter((l) => l !== line).join("\n"));
  assert.equal(parseForJulian(result.text).length, 2);
});

test("removeForJulianLine reports removed false for an unknown line", () => {
  assert.deepEqual(removeForJulianLine(PLAN, "- Test [[goal-other]]: nothing."), { text: PLAN, removed: false, index: -1, removedText: "" });
  assert.deepEqual(removeForJulianLine(PLAN, ""), { text: PLAN, removed: false, index: -1, removedText: "" });
  assert.equal(removeForJulianLine("# Plan\n", "- Decide: which one?").removed, false);
});

test("removeForJulianLine drops a Test entry's indented continuation line with it", () => {
  const first = "- Test [[goal-timeline]]: open the Tangent Area view.";
  const continuation = "  Your rows now sit under the brain line; Read opens the Document.";
  const plan = [
    "# Plan for otto/tangent",
    "",
    "## For Julian",
    "",
    "- Decide [[design-x]]: which one?",
    first,
    continuation,
    "- Decide: one question?",
    "",
    "## Later",
    "",
  ].join("\n");
  const result = removeForJulianLine(plan, first);
  assert.equal(result.removed, true);
  assert.equal(result.removedText, `${first}\n${continuation}`);
  assert.equal(result.text.includes(continuation), false, "the continuation line does not dangle");
  assert.deepEqual(parseForJulian(result.text).map((row) => row.kind), ["decide", "decide"]);
  // Undo restores both lines together.
  assert.equal(restoreForJulianLine(result.text, result.removedText, result.index), plan);
});

test("restoreForJulianLine puts the line back at its index", () => {
  const line = "- Test [[goal-find-a-document]]: press Cmd+K, type a title, press Enter.";
  const removed = removeForJulianLine(PLAN, line);
  assert.equal(restoreForJulianLine(removed.text, line, removed.index), PLAN);
});

test("restoreForJulianLine creates the section when absent", () => {
  const line = "- Decide: should the audit cover the Usage UI too?";
  const text = restoreForJulianLine("# Plan\n\n## Waves\n\n- one\n", line, 0);
  assert.match(text, /## For Julian\n\n- Decide: should the audit cover the Usage UI too\?\n$/);
  assert.deepEqual(parseForJulian(text).map((row) => row.text), ["should the audit cover the Usage UI too?"]);
});
