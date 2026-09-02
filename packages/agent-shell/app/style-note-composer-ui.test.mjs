// What Julian sees when he leaves a style note, rendered by the real shell.
//
// The reading column is the surface the whole design protects, so these tests
// render it through markdownToHtml itself rather than through a stub: the
// switch has to be visible before he writes, and the observation has to be
// absent from the Document afterwards.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import documentComments from "./public/document-comments.js";
import { browserBundle } from "./test-browser-bundle.mjs";

const shellBundle = await browserBundle();
const here = path.dirname(fileURLToPath(import.meta.url));

const DOCUMENT = [
  "# Scene generation",
  "",
  "## Rendering",
  "",
  "The {==render pass==}{>>Julian: Name the pass.<<} runs once.",
].join("\n");

/**
 * Loads shell.js into a fresh JSDOM window, as the other rendering tests do,
 * and closes it when the test ends. A JSDOM window holds timers and its own
 * event loop, so a test file that leaves one open passes and then never lets
 * the process exit.
 */
async function loadShell(t) {
  const html = await readFile(path.join(here, "public", "shell.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.setInterval = () => 0;
  // shell.js loads its initial state at the bottom of the file. These tests
  // only need its pure rendering functions, which are defined before that, so
  // the boot request is left unsettled: a stub that resolves starts a chain
  // that outlives the test and then touches a closed window.
  window.fetch = () => new Promise(() => {});
  window.eval(shellBundle);
  t.after(() => window.close());
  return window;
}

/** Renders the reading column with one composer open on the Document. */
function render(window, composer) {
  return window.markdownToHtml(DOCUMENT, { comments: documentComments.parseComments(DOCUMENT), composer, baseFile: "otto/test/design-scene.md" });
}

/** One new-note composer anchored to the selected words. */
function composerOn(kind) {
  return { kind, file: "otto/test/design-scene.md", text: "Three clauses before the subject.", notice: "", editing: null, replying: null, section: null, anchor: { kind: "selection", quote: "render pass" }, placeLine: 4 };
}

test("the composer offers the choice between a comment and a style note before anything is written", async (t) => {
  const window = await loadShell(t);
  const html = render(window, composerOn("comment"));
  assert.match(html, /data-comment-kind="comment" aria-pressed="true"/);
  assert.match(html, /data-comment-kind="style" aria-pressed="false"/);
  assert.match(html, /Save comment/);
});

test("choosing a style note says it stays out of the Document, where Julian reads it before writing", async (t) => {
  const window = await loadShell(t);
  const html = render(window, composerOn("style"));
  assert.match(html, /data-comment-kind="style" aria-pressed="true"/);
  assert.match(html, /Kept out of the Document; nobody is told\./);
  assert.match(html, /Save style note/);
  assert.match(html, /aria-label="New style note"/);
  assert.match(html, /On “render pass”/, "the words the note is about are still named");
});

test("an edit and a reply show no kind switch, because both are about an existing comment", async (t) => {
  const window = await loadShell(t);
  const comment = documentComments.parseComments(DOCUMENT)[0];
  for (const composer of [
    { ...composerOn("style"), editing: comment, anchor: { kind: "edit" } },
    { ...composerOn("style"), replying: comment },
  ]) {
    const html = render(window, composer);
    assert.doesNotMatch(html, /data-comment-kind/);
    assert.doesNotMatch(html, /Save style note/);
  }
});

test("a style note never renders in the reading column, and existing comments keep their asides", async (t) => {
  const window = await loadShell(t);
  const html = render(window, null);
  assert.doesNotMatch(html, /Three clauses/, "the observation lives only in the corpus");
  assert.doesNotMatch(html, /\{&gt;&gt;|\{>>/, "no comment markup leaks into the reading column");
  assert.match(html, /Name the pass\./, "the existing Julian comment still shows");
  assert.match(html, /<mark[^>]*>render pass<\/mark>/, "its highlighted anchor is unchanged");
});

test("the kind switch is wired to the controller in both readers", async () => {
  // The full click-through belongs in the focus-shell UI suite, whose shared
  // Go-to fixture does not open a Document on this branch's base commit. Until
  // that is fixed, the composition itself is what a rename or a dropped
  // destructure would break, so it is asserted directly, as
  // shell-browser-boundaries.test.mjs already asserts composition.
  const [bindings, shell, controller] = await Promise.all([
    readFile(path.join(here, "public", "shell-event-bindings.js"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "document-reader-controller.js"), "utf8"),
  ]);
  const routed = bindings.match(/if \(commentKind\) return setCommentKind\(commentKind\.dataset\.commentKind\);/g) ?? [];
  assert.equal(routed.length, 2, "the quick reader and the full reader both route the switch");
  assert.match(bindings, /openCommentComposer, setCommentKind, setCommentScope/, "the bindings receive it from the documents record");
  assert.match(shell, /openCommentComposer, setCommentKind, setCommentScope, syncCommentDraft/, "shell.js takes it off the controller");
  assert.match(shell, /openDocumentHeading, openCommentComposer, setCommentKind, setCommentScope/, "and passes it into the documents record");
  assert.match(controller, /openCommentComposer, setCommentKind, setCommentScope, existingCommentAnchor/, "the controller exports it");
});
