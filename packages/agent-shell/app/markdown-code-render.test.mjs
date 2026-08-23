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

/** Loads shell.js (plus the browser globals it expects, as shell.html does) into a fresh JSDOM window. */
async function loadShell() {
  const [html, script, comments, highlight, goToCore, goalCardCore, askCore, mapCore, mapView] = await Promise.all([
    readFile(path.join(here, "public", "shell.html"), "utf8"),
    readFile(path.join(here, "public", "shell.js"), "utf8"),
    readFile(path.join(here, "public", "document-comments.js"), "utf8"),
    readFile(path.join(here, "public", "code-highlight.js"), "utf8"),
    readFile(path.join(here, "public", "go-to-core.js"), "utf8"),
    readFile(path.join(here, "public", "goal-card-core.js"), "utf8"),
    readFile(path.join(here, "public", "ask-core.js"), "utf8"),
    readFile(path.join(here, "public", "area-map-core.js"), "utf8"),
    readFile(path.join(here, "public", "area-map.js"), "utf8"),
  ]);
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://agent-shell.test/" });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  // shell.js polls the server and loads initial state at the bottom of the
  // file; these tests only need its pure rendering functions, so stub both
  // before eval, as the existing shell UI tests do.
  window.setInterval = () => 0;
  window.fetch = async () => ({
    ok: true,
    status: 200,
    /** Empty body: these tests only exercise pure rendering, not the polled state. */
    async json() { return {}; },
  });
  window.eval(shellBundle);
  return window;
}

const DOCUMENT = [
  "# Title",
  "",
  "Use `inline code` in a sentence.",
  "",
  "```js",
  "const x = 1; // keep",
  "function f() { return x; }",
  "```",
  "",
  "After the block.",
  "",
  "```",
  "plain, unlabeled fence",
  "```",
].join("\n");

test("inline code renders as <code>, unchanged by the fenced-block work", async () => {
  const window = await loadShell();
  const out = window.markdownToHtml(DOCUMENT);
  assert.match(out, /<p data-line="2">Use <code>inline code<\/code> in a sentence\.<\/p>/);
});

test("a fenced block with a known language renders highlighted, escaped code and keeps later line numbers correct", async () => {
  const window = await loadShell();
  const out = window.markdownToHtml(DOCUMENT);
  assert.match(out, /<div class="markdown-code-wrap" data-line="4">/);
  assert.match(out, /<div class="markdown-code-lang">js<\/div>/);
  assert.match(out, /<pre><code class="language-javascript">/);
  assert.match(out, /<span class="tok-keyword">const<\/span>/);
  assert.match(out, /<span class="tok-comment">\/\/ keep<\/span>/);
  // The block is not split back into per-line paragraphs.
  assert.doesNotMatch(out, /<p data-line="5">/);
  // The line count the fence's three lines occupy is preserved, so the next
  // paragraph keeps its real file line.
  assert.match(out, /<p data-line="9">After the block\.<\/p>/);
});

test("an unlabeled fence renders as a plain escaped code block with no language label or spans", async () => {
  const window = await loadShell();
  const out = window.markdownToHtml(DOCUMENT);
  const start = out.indexOf('<div class="markdown-code-wrap" data-line="11">');
  assert.ok(start >= 0);
  const block = out.slice(start, out.indexOf("</div>", start) + "</div>".length);
  assert.equal(block, '<div class="markdown-code-wrap" data-line="11"><pre><code>plain, unlabeled fence</code></pre></div>');
});

test("a fenced block never becomes a CriticMarkup comment, and content around it still can", async () => {
  const window = await loadShell();
  const comments = documentComments;
  const withFence = "# T\n\n```\n{>>Julian: fenced, not a comment<<}\n```\n\nReal text.\n";
  assert.equal(comments.parseComments(withFence).length, 0);
  const commented = comments.insertComment(withFence, { kind: "selection", quote: "Real text" }, "Say more").text;
  const parsed = comments.parseComments(commented);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].quote, "Real text");
  const rendered = window.markdownToHtml(commented, { comments: parsed });
  assert.match(rendered, /<mark class="document-comment-mark"/);
  assert.match(rendered, /class="markdown-code-wrap"/);
});

test("code text is escaped, never interpreted as HTML", async () => {
  const window = await loadShell();
  const withMarkup = "```js\nconst s = \"<img onerror=alert(1)>\";\n```\n";
  const out = window.markdownToHtml(withMarkup);
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img onerror=alert\(1\)&gt;/);
});

test("heading lookalikes inside fenced blocks stay out of the outline and never shift anchors", async () => {
  const window = await loadShell();
  const doc = [
    "# Title",
    "",
    "## State",
    "",
    "```markdown",
    "## State",
    "# a bash-style comment would match too",
    "```",
    "",
    "## State",
    "",
    "text",
  ].join("\n");
  const headings = window.markdownHeadings(doc);
  assert.equal(headings.map((heading) => heading.id).join(" "), "title state state-2");
  const rendered = window.markdownToHtml(doc);
  const renderedIds = [...rendered.matchAll(/<h\d id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(renderedIds.join(" "), "title state state-2");
});

test("a section comment lands under the real heading, never on a fenced lookalike", async () => {
  const window = await loadShell();
  const comments = documentComments;
  const doc = ["# Title", "", "```markdown", "## State", "```", "", "## State", "", "text"].join("\n");
  const out = comments.insertComment(doc, { kind: "section", heading: "State" }, "Note").text;
  const lines = out.split("\n");
  const markupAt = lines.indexOf("{>>Julian: Note<<}");
  assert.ok(markupAt > lines.indexOf("## State", 4), "comment sits after the real heading, not inside the fence");
  assert.equal(comments.parseComments(out).length, 1);
});

test("an unterminated fence still renders as code instead of hanging or throwing", async () => {
  const window = await loadShell();
  const out = window.markdownToHtml("```js\nconst x = 1;\n");
  assert.match(out, /class="markdown-code-wrap"/);
  assert.match(out, /<span class="tok-keyword">const<\/span> x = <span class="tok-number">1<\/span>;/);
});
