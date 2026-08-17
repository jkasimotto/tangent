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
  let stripped = text;
  for (const comment of comments.parseComments(stripped).reverse()) stripped = comments.removeComment(stripped, comment);
  assert.equal(stripped, DOCUMENT);
});

test("editing keeps the place and the quoted words", () => {
  const text = comments.insertComment(DOCUMENT, { kind: "selection", quote: "some words" }, "Old").text;
  const [comment] = comments.parseComments(text);
  assert.match(comments.replaceCommentText(text, comment, "New words"), /\{==some words==\}\{>>Julian: New words<<\} here/);
});
