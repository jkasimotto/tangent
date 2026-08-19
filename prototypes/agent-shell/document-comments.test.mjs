import assert from "node:assert/strict";
import test from "node:test";

await import("./public/document-comments.js");
const comments = globalThis.AgentShellDocumentComments;

const DOCUMENT = "---\ntype: document\n---\n\n# Title\n\nIntro para with some words here.\n\n## Part two\n\nMore text.\n\n`{>>not a comment<<}`\n";

test("comments are inserted at the title, under a section, and around selected words", () => {
  let text = comments.insertComment(DOCUMENT, { kind: "document" }, "Overall too long").text;
  text = comments.insertComment(text, { kind: "section", heading: "Part two" }, "Wrong").text;
  text = comments.insertComment(text, { kind: "selection", quote: "some words" }, "Say  why\nplease").text;
  assert.match(text, /# Title\n\n\{>>Julian: Overall too long<<\}\n\nIntro para with \{==some words==\}\{>>Julian: Say why please<<\} here\.\n\n## Part two\n\n\{>>Julian: Wrong<<\}\n\nMore text\./);
  const parsed = comments.parseComments(text);
  assert.deepEqual(parsed.map((comment) => [comment.author, comment.text, comment.quote, comment.standalone]), [
    ["Julian", "Overall too long", null, true],
    ["Julian", "Say why please", "some words", false],
    ["Julian", "Wrong", null, true],
  ]);
  assert.equal(parsed[2].line, 12);
});

test("insertion refuses missing or ambiguous anchors instead of guessing", () => {
  assert.match(comments.insertComment(DOCUMENT, { kind: "section", heading: "Nope" }, "x").error, /section is gone/);
  assert.match(comments.insertComment(DOCUMENT, { kind: "selection", quote: "vanished words" }, "x").error, /selected changed/);
  const twice = "# T\n\nsame words\n\nsame words\n";
  assert.match(comments.insertComment(twice, { kind: "selection", quote: "same words" }, "x").error, /more than once/);
  assert.match(comments.insertComment(twice, { kind: "selection", quote: "same words", line: 4 }, "x").text, /same words\n\n\{==same words==\}\{>>Julian: x<<\}\n/);
});

test("code is never a comment", () => {
  assert.equal(comments.parseComments(DOCUMENT).length, 0);
  assert.equal(comments.parseComments("```\n{>>Julian: fenced<<}\n```\n").length, 0);
});

test("removing every comment restores the original text, and resolve matches exactly one", () => {
  let text = comments.insertComment(DOCUMENT, { kind: "document" }, "Overall too long").text;
  text = comments.insertComment(text, { kind: "section", heading: "Part two" }, "Wrong here").text;
  text = comments.insertComment(text, { kind: "selection", quote: "some words" }, "Say why").text;
  const resolved = comments.resolveComment(text, "wrong");
  assert.equal(resolved.comment.text, "Wrong here");
  assert.doesNotMatch(resolved.text, /Wrong here/);
  assert.match(comments.resolveComment(text, "nothing like this").error, /No open comment/);
  assert.equal(comments.resolveComment(text, "").matches.length, 0);
  // Offsets move with every removal, so the text is parsed again between them.
  let stripped = text;
  for (let guard = 0; guard < 5; guard += 1) {
    const parsed = comments.parseComments(stripped);
    if (!parsed.length) break;
    stripped = comments.removeComment(stripped, parsed.at(-1));
  }
  assert.equal(stripped, DOCUMENT);
});

test("editing keeps the place and the quoted words", () => {
  const text = comments.insertComment(DOCUMENT, { kind: "selection", quote: "some words" }, "Old").text;
  const [comment] = comments.parseComments(text);
  assert.match(comments.replaceCommentText(text, comment, "New words"), /\{==some words==\}\{>>Julian: New words<<\} here/);
});

/** Every comment of one line as author-free pairs, for a short assertion. */
function quotes(text) {
  return comments.parseComments(text).map((comment) => [comment.text, comment.quote]);
}

test("visibleLine maps rendered characters back to the source", () => {
  const line = "## Intro with **bold**, `code`, [[target|alias]], [label](https://x) and {==old==}{>>Julian: c<<} end";
  const tokens = comments.commentTokensOnLine(comments.parseComments(line), 0);
  const visible = comments.visibleLine(line, tokens);
  assert.equal(visible.text, "Intro with bold, code, alias, label and old end");
  assert.equal(line[visible.offsets[visible.text.indexOf("bold")]], "b");
  assert.equal(visible.spans.length, 4, "bold, code, wiki link, and Markdown link each stay one unit");
});

test("marks nest, share, and come in pieces, and each comment keeps its own words", () => {
  assert.deepEqual(quotes("{==brown fox==}{>>Julian: first<<}"), [["first", "brown fox"]]);
  assert.deepEqual(quotes("{==brown fox==}{>>Julian: first<<}{>>Julian: second<<}"), [["first", "brown fox"], ["second", "brown fox"]]);
  assert.deepEqual(quotes("{==brown {==fox==}{>>Julian: second<<}==}{>>Julian: first<<}"), [["second", "fox"], ["first", "brown fox"]]);
  assert.deepEqual(quotes("{=={==brown fox==}{>>Julian: first<<} jumps==}{>>Julian: second<<}"), [["first", "brown fox"], ["second", "brown fox jumps"]]);
  assert.deepEqual(quotes("{==brown {==fox==}==}{>>Julian: first<<}{== jumps==}{>>Julian: second<<}"), [["first", "brown fox"], ["second", "fox jumps"]]);
  assert.deepEqual(quotes("brown {==fox==}{== jumps==}{>>Julian: second<<}"), [["second", "fox jumps"]]);
  assert.deepEqual(quotes("{==runs **home** fast==}{>>Julian: x<<}"), [["x", "runs home fast"]]);
  // A closed mark that no comment touches stays plain text.
  assert.deepEqual(quotes("{==a==} b {==c==}{>>Julian: x<<}"), [["x", "c"]]);
  const pieced = comments.parseComments("{==brown {==fox==}==}{>>Julian: first<<}{== jumps==}{>>Julian: second<<}");
  assert.equal(pieced[1].pieces.length, 2, "a crossing comment records both pieces of its mark");
  assert.deepEqual(comments.commentTokensOnLine(pieced, 0).map((token) => token.kind), ["open", "open", "close", "close", "comment", "open", "close", "comment"]);
});

test("removing one comment of an overlapping pair leaves the other exact", () => {
  const crossing = "The quick {==brown {==fox==}==}{>>Julian: first<<}{== jumps==}{>>Julian: second<<} over.";
  /** The text with the one comment whose words are `body` taken out. */
  const without = (text, body) => comments.removeComment(text, comments.parseComments(text).find((comment) => comment.text === body));
  assert.equal(without(crossing, "first"), "The quick brown {==fox==}{== jumps==}{>>Julian: second<<} over.");
  assert.deepEqual(quotes(without(crossing, "first")), [["second", "fox jumps"]]);
  assert.equal(without(crossing, "second"), "The quick {==brown fox==}{>>Julian: first<<} jumps over.");
  const nested = "The {==brown {==fox==}{>>Julian: second<<}==}{>>Julian: first<<} jumps.";
  assert.deepEqual(quotes(without(nested, "first")), [["second", "fox"]]);
  assert.deepEqual(quotes(without(nested, "second")), [["first", "brown fox"]]);
  const shared = "The {==brown fox==}{>>Julian: first<<}{>>Julian: second<<} jumps.";
  assert.equal(without(shared, "first"), "The {==brown fox==}{>>Julian: second<<} jumps.");
  assert.equal(without(shared, "second"), "The {==brown fox==}{>>Julian: first<<} jumps.");
  // Taking every comment out, newest first, puts the original sentence back.
  let stripped = crossing;
  for (let guard = 0; guard < 5; guard += 1) {
    const parsed = comments.parseComments(stripped);
    if (!parsed.length) break;
    stripped = comments.removeComment(stripped, parsed.at(-1));
  }
  assert.equal(stripped, "The quick brown fox jumps over.");
});
