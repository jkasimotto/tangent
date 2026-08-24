import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentReaderView } from "./public/document-reader-view.js";

/** Returns a value unchanged for view dependencies that format labels. */
function identity(value) { return value; }

/** Renders no Markdown because these tests inspect only the toolbar. */
function emptyHtml() { return ""; }

/** Represents an absent linked Goal. */
function noGoal() { return null; }

/** Represents an empty collection dependency. */
function noItems() { return []; }

/** Renders no Area path because these tests inspect only brain actions. */
function noAreaPath() { return ""; }

/** Renders the toolbar for a live brain and the supplied comments. */
function toolbar(comments) {
  const state = {
    brains: [{ area: "otto/tangent", status: "running", live: true, session: "tangent-brain" }],
    document: { area: "otto/tangent", title: "Plan", file: "otto/tangent/plan.md", text: "", comments },
    documentTrail: [], documentTrailIndex: -1, vault: { documents: [] },
  };
  return createDocumentReaderView({
    state, markdownToHtml: emptyHtml, currentGoal: noGoal, goalByFile: noGoal,
    sessionsForGoal: noItems, areaLabel: identity, areaPath: noAreaPath, humanName: identity,
  }).documentToolbar(null);
}

test("the Document brain action offers notify and navigation", () => {
  const html = toolbar([{ text: "Please clarify." }]);
  assert.match(html, /<details class="reader-brain-actions">/);
  assert.match(html, /data-notify-document-comments/);
  assert.match(html, /data-open-brain="tangent-brain"/);
  assert.match(html, />Go to brain</);
});

test("brain navigation remains available without comments", () => {
  const html = toolbar([]);
  assert.match(html, /data-notify-document-comments[^>]*disabled/);
  assert.match(html, /data-open-brain="tangent-brain"/);
});
