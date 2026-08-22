import assert from "node:assert/strict";
import test from "node:test";

await import("./public/code-highlight.js");
const highlight = globalThis.AgentShellCodeHighlight;

test("known fence tags normalize through their aliases; unknown tags resolve to null", () => {
  assert.equal(highlight.normalizeLanguage("js"), "javascript");
  assert.equal(highlight.normalizeLanguage("TS"), "typescript");
  assert.equal(highlight.normalizeLanguage("sh"), "bash");
  assert.equal(highlight.normalizeLanguage("md"), "markdown");
  assert.equal(highlight.normalizeLanguage("json5"), "json");
  assert.equal(highlight.normalizeLanguage("cobol"), null);
  assert.equal(highlight.normalizeLanguage(""), null);
  assert.equal(highlight.normalizeLanguage(undefined), null);
});

test("javascript tokenizes keywords, strings, numbers, and comments", () => {
  const out = highlight.highlightHtml('const x = 1; // one\nfunction f() { return "hi"; }', "js");
  assert.match(out, /<span class="tok-keyword">const<\/span>/);
  assert.match(out, /<span class="tok-number">1<\/span>/);
  assert.match(out, /<span class="tok-comment">\/\/ one<\/span>/);
  assert.match(out, /<span class="tok-keyword">function<\/span>/);
  assert.match(out, /<span class="tok-function">f<\/span>/);
  assert.match(out, /<span class="tok-string">&quot;hi&quot;<\/span>/);
});

test("bash tokenizes variables, keywords, and comments", () => {
  // $HOME is unquoted so the variable rule claims it; a quoted string like
  // "$X" is one opaque string token, which is a deliberate simplification.
  const out = highlight.highlightHtml('echo $HOME # home\nif [ -z "$X" ]; then exit 1; fi', "bash");
  assert.match(out, /<span class="tok-variable">\$HOME<\/span>/);
  assert.match(out, /<span class="tok-comment"># home<\/span>/);
  assert.match(out, /<span class="tok-keyword">if<\/span>/);
  assert.match(out, /<span class="tok-keyword">fi<\/span>/);
  assert.match(out, /<span class="tok-string">&quot;\$X&quot;<\/span>/);
});

test("json tokenizes property keys separately from string values", () => {
  const out = highlight.highlightHtml('{"a": 1, "b": true, "c": "x"}', "json");
  assert.match(out, /<span class="tok-property">&quot;a&quot;<\/span>/);
  assert.match(out, /<span class="tok-keyword">true<\/span>/);
  assert.match(out, /<span class="tok-string">&quot;x&quot;<\/span>/);
});

test("an unknown language falls back to escaped plain text with no spans", () => {
  const out = highlight.highlightHtml("select * from t;", "sql");
  assert.equal(out, "select * from t;");
  assert.doesNotMatch(out, /<span/);
});

test("highlighting always escapes source text, even when it looks like markup", () => {
  const out = highlight.highlightHtml('const s = "<img onerror=alert(1)>";', "js");
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img onerror=alert\(1\)&gt;/);
  const plain = highlight.highlightHtml("<script>alert(1)</script>", "text");
  assert.doesNotMatch(plain, /<script>/);
});
