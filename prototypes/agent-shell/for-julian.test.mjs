import test from "node:test";
import assert from "node:assert/strict";
import { parseForJulian, removeForJulianLine, restoreForJulianLine } from "./for-julian.mjs";

const PLAN = [
  "# Plan for otto/tangent",
  "",
  "## Waves",
  "",
  "- Decision [[design-not-listed]]: this line is in another section.",
  "",
  "## For Julian",
  "",
  "- Decision [[design-x]]: 5 questions. Unblocks: audit tier 4.",
  "- Try it [[goal-find-a-document]]: press Cmd+K, type a title, press Enter.",
  "- Brain: should the audit cover the Usage UI too?",
  "",
  "## Later",
  "",
  "- nothing yet",
  "",
].join("\n");

test("parses the three line shapes in order", () => {
  const rows = parseForJulian(PLAN);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.kind), ["decision", "tryit", "brain"]);
  assert.deepEqual(rows.map((row) => row.target), ["design-x", "find-a-document", null]);
  assert.deepEqual(rows.map((row) => row.index), [1, 2, 3]);
  assert.equal(rows[2].text, "should the audit cover the Usage UI too?");
});

test("splits Unblocks off a Decision line", () => {
  const rows = parseForJulian("## For Julian\n\n- Decision [[design-x]]: 5 questions. Unblocks: audit tier 4.\n");
  assert.equal(rows[0].text, "5 questions");
  assert.equal(rows[0].unblocks, "audit tier 4");
});

test("a Decision line without Unblocks has unblocks null", () => {
  const rows = parseForJulian("## For Julian\n\n- Decision [[design-x]]: 5 questions.\n");
  assert.equal(rows[0].text, "5 questions");
  assert.equal(rows[0].unblocks, null);
});

test("a Try it link with or without goal- gives the slug", () => {
  const rows = parseForJulian([
    "## For Julian",
    "",
    "- Try it [[goal-find-a-document]]: press Cmd+K.",
    "- Try it [[find-a-document]]: press Cmd+K.",
    "- Try it [[goal-find-a-document.md|the finder]]: press Cmd+K.",
  ].join("\n"));
  assert.deepEqual(rows.map((row) => row.target), ["find-a-document", "find-a-document", "find-a-document"]);
  assert.equal(rows[0].text, "press Cmd+K.");
});

test("ignores lines outside the section and lines in another shape", () => {
  const rows = parseForJulian([
    "## Waves",
    "",
    "- Decision [[design-elsewhere]]: not shown.",
    "",
    "## For Julian",
    "",
    "- Idea: not a known shape.",
    "**Decision** [[design-x]]: bold does not match.",
    "A plain paragraph.",
    "",
  ].join("\n"));
  assert.deepEqual(rows, []);
});

test("returns [] when the section is absent", () => {
  assert.deepEqual(parseForJulian("# Plan\n\n## Waves\n\n- one\n"), []);
  assert.deepEqual(parseForJulian(""), []);
  assert.deepEqual(parseForJulian(null), []);
});

test("removeForJulianLine removes only the first equal line and leaves the rest byte-for-byte", () => {
  const line = "- Try it [[goal-find-a-document]]: press Cmd+K, type a title, press Enter.";
  const result = removeForJulianLine(PLAN, line);
  assert.equal(result.removed, true);
  assert.equal(result.index, 2);
  assert.equal(result.text, PLAN.split("\n").filter((l) => l !== line).join("\n"));
  assert.equal(parseForJulian(result.text).length, 2);
});

test("removeForJulianLine reports removed false for an unknown line", () => {
  assert.deepEqual(removeForJulianLine(PLAN, "- Try it [[goal-other]]: nothing."), { text: PLAN, removed: false, index: -1, removedText: "" });
  assert.deepEqual(removeForJulianLine(PLAN, ""), { text: PLAN, removed: false, index: -1, removedText: "" });
  assert.equal(removeForJulianLine("# Plan\n", "- Brain: x").removed, false);
});

test("removeForJulianLine drops a Try it entry's indented continuation line with it", () => {
  const first = "- Try it [[goal-timeline]]: open the Tangent Area view.";
  const continuation = "  Your Decision and Try it rows now sit under the brain line; Read opens the Document.";
  const plan = [
    "# Plan for otto/tangent",
    "",
    "## For Julian",
    "",
    "- Decision [[design-x]]: 5 questions.",
    first,
    continuation,
    "- Brain: one question.",
    "",
    "## Later",
    "",
  ].join("\n");
  const result = removeForJulianLine(plan, first);
  assert.equal(result.removed, true);
  assert.equal(result.removedText, `${first}\n${continuation}`);
  assert.equal(result.text.includes(continuation), false, "the continuation line does not dangle");
  assert.deepEqual(parseForJulian(result.text).map((row) => row.kind), ["decision", "brain"]);
  // Undo restores both lines together.
  assert.equal(restoreForJulianLine(result.text, result.removedText, result.index), plan);
});

test("restoreForJulianLine puts the line back at its index", () => {
  const line = "- Try it [[goal-find-a-document]]: press Cmd+K, type a title, press Enter.";
  const removed = removeForJulianLine(PLAN, line);
  assert.equal(restoreForJulianLine(removed.text, line, removed.index), PLAN);
});

test("restoreForJulianLine creates the section when absent", () => {
  const line = "- Brain: should the audit cover the Usage UI too?";
  const text = restoreForJulianLine("# Plan\n\n## Waves\n\n- one\n", line, 0);
  assert.match(text, /## For Julian\n\n- Brain: should the audit cover the Usage UI too\?\n$/);
  assert.deepEqual(parseForJulian(text).map((row) => row.text), ["should the audit cover the Usage UI too?"]);
});
