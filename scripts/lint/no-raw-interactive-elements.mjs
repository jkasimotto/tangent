#!/usr/bin/env node
import ts from "typescript";
import { UI_OWNER, reasonHit, runMarkupLint, walkNodes } from "./lib/markup-lint-ast.mjs";

// Feature markup composes the kit. A raw <button>, <input>, <select> or
// <textarea> outside packages/agent-shell/app/map/ui/ bypasses every token,
// size and focus decision the kit makes, so the kit is the one owner of those
// elements. Only .tsx files render markup, so only they are inspected.

const EXTENSIONS = new Set([".tsx"]);
const RAW_INTERACTIVE_TAGS = new Set(["button", "input", "select", "textarea"]);
const REMEDY = `Compose the kit under ${UI_OWNER} (Button, TextField, Listbox); a raw interactive element bypasses its tokens, sizes and focus rules (app/map/AGENTS.md).`;

/** Returns the intrinsic tag a JSX element opens, or null for components and other nodes. */
function intrinsicTag(node) {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return null;
  return ts.isIdentifier(node.tagName) ? node.tagName.text : null;
}

/** Collects every raw interactive element in one parsed feature file. */
export function collectRawInteractiveElements(sourceFile, file) {
  const hits = [];

  /** Records an element when its tag is one the kit owns. */
  function inspect(node) {
    const tag = intrinsicTag(node);
    if (tag !== null && RAW_INTERACTIVE_TAGS.has(tag)) hits.push(reasonHit(sourceFile, file, node, `raw <${tag}> outside the kit`));
  }

  walkNodes(sourceFile, inspect);
  return hits;
}

/** True inside the kit, the one owner of raw interactive elements. */
function isExempt(repoPath) {
  return repoPath.startsWith(UI_OWNER);
}

runMarkupLint({ name: "no-raw-interactive-elements", extensions: EXTENSIONS, isExempt, collect: collectRawInteractiveElements, remedy: REMEDY });
