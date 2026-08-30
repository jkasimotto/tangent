import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { cleanDocumentMarkdown, documentCopyPayload, selectedDocumentMarkdown } from "./public/document-copy.js";

test("whole Document copy removes private markup and preserves literal code", () => {
  const source = `---\ntype: document\n---\n\nIntro {>>Julian: private<<} and {==kept==}.\n\n[[design-clean-copy]] and [[goal-x|Named]].\n\nInline \`{>>literal<<} [[literal-link]]\`.\n\n\`\`\`md\n{>>literal<<}\n[[literal-link]]\n\`\`\``;
  /** Resolves one fixture wiki title. */
  const resolveWikiTitle = (target) => target === "design-clean-copy" ? "Clean copy" : "";
  assert.equal(cleanDocumentMarkdown(source, { title: "Clean Copy", resolveWikiTitle }), `# Clean Copy

Intro  and kept.

Clean copy and Named.

Inline \`{>>literal<<} [[literal-link]]\`.

\`\`\`md
{>>literal<<}
[[literal-link]]
\`\`\``);
});

test("whole Document copy does not add a duplicate source H1", () => {
  assert.equal(cleanDocumentMarkdown("# Existing\n\nBody", { title: "Other" }), "# Existing\n\nBody");
});

/** Maps one fixture DOM Range back to its source Markdown. */
function selected(source, html, startSelector, startOffset, endSelector, endOffset, { reverse = false } = {}) {
  const dom = new JSDOM(`<div class="document-content">${html}</div>`);
  const root = dom.window.document.querySelector(".document-content");
  const start = root.querySelector(startSelector).firstChild;
  const end = root.querySelector(endSelector).firstChild;
  const range = dom.window.document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  if (reverse && selection.setBaseAndExtent) selection.setBaseAndExtent(end, endOffset, start, startOffset);
  return selectedDocumentMarkdown({ text: source, root, selection });
}

test("partial structured selections retain headings, inline balance, lists, and quotes", () => {
  const source = "## Alpha **bold words** omega\n  3. Nested item\n> Quoted words";
  const html = `<h2 data-copy-block="0">Alpha <strong>bold words</strong> omega</h2><ol><li data-copy-block="1">Nested item</li></ol><blockquote data-copy-block="2">Quoted words</blockquote>`;
  assert.equal(selected(source, html, "h2", 6, "blockquote", 6), `## **bold words** omega

3. Nested item

> Quoted`);
});

test("a cut link becomes text while a complete link stays Markdown", () => {
  const source = "Before [linked words](https://example.com) after";
  const html = `<p data-copy-block="0">Before <a>linked words</a> after</p>`;
  assert.equal(selected(source, html, "a", 1, "a", 7), "inked");
  assert.equal(selected(source, html, "a", 0, "a", 12), "[linked words](https://example.com)");
});

test("a code slice always has a safe language fence", () => {
  const source = "~~~js\nconst one = 1;\n~~~\nconst two = 2;\n~~~";
  const html = `<div data-copy-block="0"><pre><code>const one = 1;\n~~~\nconst two = 2;</code></pre></div>`;
  const result = selected(source, html, "code", 6, "code", 30);
  assert.match(result, /^~~~~js\n/);
  assert.match(result, /\n~~~~$/);
});

test("a single table cell is a paragraph and touched rows retain the header", () => {
  const source = "| A | B |\n| --- | --- |\n| one | two |\n| three | four |";
  const html = `<div data-copy-block="0"><table><thead><tr><th data-copy-row="0" data-copy-cell="0">A</th><th data-copy-row="0" data-copy-cell="1">B</th></tr></thead><tbody><tr><td data-copy-row="1" data-copy-cell="0">one</td><td data-copy-row="1" data-copy-cell="1">two</td></tr><tr><td data-copy-row="2" data-copy-cell="0">three</td><td data-copy-row="2" data-copy-cell="1">four</td></tr></tbody></table></div>`;
  assert.equal(selected(source, html, "td[data-copy-row='1'][data-copy-cell='1']", 0, "td[data-copy-row='1'][data-copy-cell='1']", 3), "two");
  assert.equal(selected(source, html, "td[data-copy-row='1'][data-copy-cell='0']", 0, "td[data-copy-row='2'][data-copy-cell='1']", 4), `| A | B |
| --- | --- |
| one | two |
| three | four |`);
});

test("whitespace and a selection anchored outside the reading column stand down", () => {
  const dom = new JSDOM(`<p id="outside">Outside</p><div class="document-content"><p data-copy-block="0">   </p></div>`);
  const root = dom.window.document.querySelector(".document-content");
  const range = dom.window.document.createRange();
  range.selectNodeContents(root.querySelector("p"));
  const selection = dom.window.getSelection();
  selection.addRange(range);
  assert.equal(selectedDocumentMarkdown({ text: "   ", root, selection }), null);
  selection.removeAllRanges();
  range.selectNodeContents(dom.window.document.querySelector("#outside"));
  selection.addRange(range);
  assert.equal(selectedDocumentMarkdown({ text: "Text", root, selection }), null);
});

test("payload keeps Markdown as plain text and delegates safe export HTML", () => {
  /** Marks the rendering mode in a minimal safe fixture renderer. */
  const markdownToHtml = (markdown, options) => `<safe data-mode="${options.mode}">${markdown}</safe>`;
  const payload = documentCopyPayload({
    source: { text: "Body", title: "Title", file: "doc.md" }, root: null, selection: null, whole: true,
    markdownToHtml,
  });
  assert.deepEqual(payload, { scope: "document", markdown: "# Title\n\nBody", html: '<safe data-mode="export"># Title\n\nBody</safe>' });
});
