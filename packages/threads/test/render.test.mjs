import assert from "node:assert/strict";
import test from "node:test";

import { buildThreadsView, filterViewBySubtree, nodeMatchesSubtree, renderThreadsMarkdown } from "../dist/core/render.js";

const now = new Date("2026-07-16T17:40:00Z");

/** Builds a render input with the given view threads and unowned items, overridable per test. */
function renderInput(threads, unowned, extra = {}) {
  return { vaultRoot: "/vault", threads, unowned, now, ...extra };
}

/** Builds a minimal ViewThread fixture. */
function viewThread(node, slug, state, overrides = {}) {
  return { slug, node, owner: "sonnet", state, why: "why line.", ...overrides };
}

/** Builds a minimal ViewItem fixture. */
function viewItem(node, text) {
  return { node, text };
}

test("threads and unowned items render as the vault's node tree with state icons", () => {
  const markdown = renderThreadsMarkdown(renderInput(
    [
      viewThread("neara/pgande", "clearances", "working"),
      viewThread("neara/pgande/autodesign", "spec-layer", "parked"),
      viewThread("otto/tangent", "attach-fix", "blocked-on-you")
    ],
    [viewItem("neara/pgande", "Get the staging branch merged")]
  ));
  const lines = markdown.split("\n");
  const pgandeIndex = lines.indexOf("neara/pgande/");
  assert.ok(pgandeIndex >= 0, `expected a collapsed "neara/pgande/" label in:\n${markdown}`);
  assert.match(lines[pgandeIndex + 1], /^  ◐ clearances /);
  assert.match(lines[pgandeIndex + 2], /^  ⚠ Get the staging branch merged$/);
  assert.match(lines[pgandeIndex + 3], /^  autodesign\/$/);
  assert.match(lines[pgandeIndex + 4], /^    ◌ spec-layer /);
  const ottoIndex = lines.indexOf("otto/tangent/");
  assert.ok(ottoIndex > pgandeIndex, "expected otto/tangent/ as its own top-level group");
  assert.match(lines[ottoIndex + 1], /^  ● attach-fix /);
  assert.equal(lines[ottoIndex - 1], "", "top-level groups are separated by a blank line");
});

test("the NEEDS YOU strip lists attention threads most urgent first, above the tree", () => {
  const markdown = renderThreadsMarkdown(renderInput(
    [
      viewThread("a", "waiting", "ready-for-you"),
      viewThread("b", "question", "blocked-on-you"),
      viewThread("c", "steady", "working")
    ],
    []
  ));
  const lines = markdown.split("\n");
  const stripIndex = lines.findIndex((line) => line.startsWith("● NEEDS YOU (2)"));
  assert.ok(stripIndex >= 0, `expected a NEEDS YOU strip in:\n${markdown}`);
  assert.match(lines[stripIndex + 1], /^  question /);
  assert.match(lines[stripIndex + 2], /^  waiting /);
  assert.doesNotMatch(lines[stripIndex + 1] + lines[stripIndex + 2], /steady/);
});

test("within a node, threads sort attention first, then working grouped by batch, then parked", () => {
  const markdown = renderThreadsMarkdown(renderInput(
    [
      viewThread("proj", "zzz-parked", "parked"),
      viewThread("proj", "fix-b", "working", { batch: "dim-fixups" }),
      viewThread("proj", "solo", "working"),
      viewThread("proj", "fix-a", "working", { batch: "dim-fixups" }),
      viewThread("proj", "stuck", "blocked-on-you")
    ],
    []
  ));
  const treeLines = markdown.split("\n").slice(markdown.split("\n").indexOf("proj/"));
  const order = treeLines.filter((line) => /^  [●◐◌]/.test(line)).map((line) => line.trim().split(/\s+/)[1]);
  assert.deepEqual(order, ["stuck", "fix-a", "fix-b", "solo", "zzz-parked"]);
  assert.match(markdown, /fix-a {2}sonnet {2}\[dim-fixups\] why line\./);
});

test("long unowned text truncates to 80 characters with a trailing ellipsis", () => {
  const markdown = renderThreadsMarkdown(renderInput([], [viewItem("proj", "a".repeat(120))]));
  const line = markdown.split("\n").find((candidate) => candidate.includes("⚠"));
  const text = line.replace(/^\s*⚠ /, "");
  assert.equal(text.length, 80);
  assert.ok(text.endsWith("…"));
});

test("an empty view renders a placeholder line instead of an empty tree", () => {
  assert.match(renderThreadsMarkdown(renderInput([], [])), /\(no open threads or backlog\)/);
  assert.match(renderThreadsMarkdown(renderInput([], [], { filter: "neara" })), /\(nothing under neara\)/);
});

test("a filtered render names the filter in its header label", () => {
  const markdown = renderThreadsMarkdown(renderInput([viewThread("neara/pgande", "x", "working")], [], { filter: "neara" }));
  assert.match(markdown.split("\n")[2], /^vault\/neara {2}/);
});

test("nodeMatchesSubtree matches path prefixes and mid-path segment runs, never partial segments", () => {
  assert.ok(nodeMatchesSubtree("neara/pgande", "neara"));
  assert.ok(nodeMatchesSubtree("neara/pgande/autodesign", "pgande"));
  assert.ok(nodeMatchesSubtree("neara/pgande/autodesign", "neara/pgande"));
  assert.ok(nodeMatchesSubtree("neara/pgande", "neara/pgande/"));
  assert.ok(!nodeMatchesSubtree("neara/pgande", "gande"));
  assert.ok(!nodeMatchesSubtree("neara/pgande", "pgande/autodesign"));
  assert.ok(!nodeMatchesSubtree("otto/finance", "neara"));
});

test("filterViewBySubtree keeps only threads and unowned items under matching nodes", () => {
  const view = {
    threads: [viewThread("neara/pgande", "keep", "working"), viewThread("otto/tangent", "drop", "working")],
    unowned: [viewItem("neara/pgande/autodesign", "keep item"), viewItem("otto", "drop item")]
  };
  const filtered = filterViewBySubtree(view, "neara");
  assert.deepEqual(filtered.threads.map((thread) => thread.slug), ["keep"]);
  assert.deepEqual(filtered.unowned.map((item) => item.text), ["keep item"]);
});

test("buildThreadsView resolves why-lines (haiku over template), drops done threads, and strips wiki-links from unowned text", () => {
  const view = buildThreadsView(
    [
      { slug: "a", node: "proj", owner: "sonnet", state: "working", templateWhy: "template why." },
      { slug: "b", node: "proj", owner: "sonnet", state: "done", templateWhy: "finished." }
    ],
    { a: "haiku why." },
    [{ node: "proj", text: "Update the [[proj/2026-07-16-bet|bet entity]] periodically", owned: false }]
  );
  assert.deepEqual(view.threads.map((thread) => [thread.slug, thread.why]), [["a", "haiku why."]]);
  assert.equal(view.unowned[0].text, "Update the bet entity periodically");
});
