import assert from "node:assert/strict";
import test from "node:test";
import { matchPosition, searchTarget, searchWords, workSearchMatches } from "./public/work-search-core.js";

const rows = [
  { cursor: "area:otto/tangent", text: "Tangent otto/tangent" },
  { cursor: "goal:a.md", text: "Redesign the onboarding walkthrough Otto / Tangent Working" },
  { cursor: "goal:b.md", text: "Land standards framework docs Standards Ready" },
  { cursor: "area:otto/standards", text: "Standards otto/standards" },
  { cursor: "goal:c.md", text: "Write the walkthrough script Otto / Tangent Waiting" },
];
const order = rows.map((row) => row.cursor);

test("every word must appear, case-insensitive, joined text counts", () => {
  assert.deepEqual(workSearchMatches(rows, "walk"), ["goal:a.md", "goal:c.md"]);
  assert.deepEqual(workSearchMatches(rows, "WALK script"), ["goal:c.md"]);
  assert.deepEqual(workSearchMatches(rows, "standards"), ["goal:b.md", "area:otto/standards"]);
  assert.deepEqual(workSearchMatches(rows, "onboardingwalk"), ["goal:a.md"], "a pattern typed without spaces still matches");
  assert.deepEqual(workSearchMatches(rows, ""), []);
  assert.deepEqual(workSearchMatches(rows, "zzz"), []);
  assert.deepEqual(searchWords("  Two  words "), ["two", "words"]);
});

test("incremental search lands at or after the origin and wraps", () => {
  const found = workSearchMatches(rows, "walk");
  assert.equal(searchTarget(found, order, { from: "area:otto/tangent", inclusive: true }), "goal:a.md");
  assert.equal(searchTarget(found, order, { from: "goal:a.md", inclusive: true }), "goal:a.md", "the origin row itself counts");
  assert.equal(searchTarget(found, order, { from: "goal:b.md", inclusive: true }), "goal:c.md");
  assert.equal(searchTarget(found, order, { from: "goal:c.md", inclusive: true }), "goal:c.md");
  assert.equal(searchTarget(found, order, { from: "", inclusive: true }), "goal:a.md", "no origin starts at the top");
});

test("n and N step from the cursor and wrap in both directions", () => {
  const found = workSearchMatches(rows, "walk");
  assert.equal(searchTarget(found, order, { from: "goal:a.md", direction: 1 }), "goal:c.md");
  assert.equal(searchTarget(found, order, { from: "goal:c.md", direction: 1 }), "goal:a.md", "wrapped to the top");
  assert.equal(searchTarget(found, order, { from: "goal:a.md", direction: -1 }), "goal:c.md", "wrapped to the bottom");
  assert.equal(searchTarget(found, order, { from: "goal:b.md", direction: -1 }), "goal:a.md");
  assert.equal(searchTarget([], order, { from: "goal:b.md" }), null);
  assert.equal(matchPosition(found, "goal:c.md"), 2);
  assert.equal(matchPosition(found, "goal:b.md"), 0);
});
