import assert from "node:assert/strict";
import test from "node:test";
import { documentHash, markdownTitle, safeMarkdownPath, wikiLinks } from "./vault-documents.mjs";

test("wikiLinks reads prose but not inline or fenced code", () => {
  const text = "[[design-one|Design]] and [[goal-work#State]] `[[not-this]]`\n```md\n[[nor-this]]\n```";
  assert.deepEqual(wikiLinks(text), ["design-one", "goal-work"]);
});

test("safeMarkdownPath confines markdown files to the vault", () => {
  assert.deepEqual(safeMarkdownPath("/vault", "otto/design.md"), {
    relative: "otto/design.md",
    absolute: "/vault/otto/design.md",
  });
  assert.equal(safeMarkdownPath("/vault", "../secret.md"), null);
  assert.equal(safeMarkdownPath("/vault", "/tmp/file.md"), null);
  assert.equal(safeMarkdownPath("/vault", "otto/file.txt"), null);
});

test("document metadata helpers are deterministic", () => {
  assert.equal(markdownTitle("# A design\n", "fallback"), "A design");
  assert.equal(markdownTitle("plain", "fallback"), "fallback");
  assert.equal(documentHash("same"), documentHash("same"));
  assert.notEqual(documentHash("same"), documentHash("changed"));
});
