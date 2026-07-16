import assert from "node:assert/strict";
import test from "node:test";

import { renderThreadsMarkdown } from "../dist/core/render.js";

const now = new Date("2026-07-16T17:40:00Z");

/** Builds a minimal render input, overridable per test. */
function renderInput(unowned) {
  return { vaultRoot: "/vault", derived: [], whyLines: {}, unowned, now };
}

/** Builds a minimal unowned OverviewItem fixture. */
function overviewItem(node, text) {
  return { node, text, owned: false };
}

/** Extracts only the UNOWNED section's lines from rendered markdown. */
function unownedLines(markdown) {
  const start = markdown.indexOf("⚠ UNOWNED");
  assert.ok(start >= 0, "expected an UNOWNED section");
  return markdown.slice(start).split("\n").filter(Boolean);
}

test("unowned items render one per line as \"<node-basename>  <text>\"", () => {
  const markdown = renderThreadsMarkdown(renderInput([
    overviewItem("neara/pgande", "Get Oscar's linting adopted in the project"),
    overviewItem("neara/pgande", "Map where each design template lives")
  ]));
  const lines = unownedLines(markdown);
  assert.equal(lines[0], "⚠ UNOWNED (2)");
  assert.equal(lines[1], "  pgande  Get Oscar's linting adopted in the project");
  assert.equal(lines[2], "  pgande  Map where each design template lives");
});

test("wiki-link syntax is stripped to display text", () => {
  const markdown = renderThreadsMarkdown(renderInput([
    overviewItem("neara/pgande", "Update the [[neara/pgande/2026-07-16-bet-entity-updates|bet entity]] periodically"),
    overviewItem("neara/pgande", "Wire the [[neara/pgande/shared/README]] to a remote")
  ]));
  const lines = unownedLines(markdown);
  assert.equal(lines[1], "  pgande  Update the bet entity periodically");
  assert.equal(lines[2], "  pgande  Wire the README to a remote");
});

test("long item text truncates to 80 characters with a trailing ellipsis", () => {
  const longText = "a".repeat(120);
  const markdown = renderThreadsMarkdown(renderInput([overviewItem("neara/pgande", longText)]));
  const lines = unownedLines(markdown);
  const rendered = lines[1].replace("  pgande  ", "");
  assert.equal(rendered.length, 80);
  assert.ok(rendered.endsWith("…"));
});

test("items sort by node then text", () => {
  const markdown = renderThreadsMarkdown(renderInput([
    overviewItem("neara/pgande", "zzz last"),
    overviewItem("neara/autodesign", "some item"),
    overviewItem("neara/pgande", "aaa first")
  ]));
  const lines = unownedLines(markdown).slice(1);
  assert.deepEqual(lines, [
    "  autodesign  some item",
    "  pgande  aaa first",
    "  pgande  zzz last"
  ]);
});

test("more than 10 items caps the list and appends a \"… and N more\" summary", () => {
  const items = Array.from({ length: 13 }, (_, index) => overviewItem("neara/pgande", `item ${String(index).padStart(2, "0")}`));
  const markdown = renderThreadsMarkdown(renderInput(items));
  const lines = unownedLines(markdown);
  assert.equal(lines[0], "⚠ UNOWNED (13)");
  assert.equal(lines.length, 1 + 10 + 1);
  assert.equal(lines.at(-1), "  … and 3 more");
});

test("no unowned section is rendered when there is no backlog", () => {
  const markdown = renderThreadsMarkdown(renderInput([]));
  assert.doesNotMatch(markdown, /UNOWNED/);
});
