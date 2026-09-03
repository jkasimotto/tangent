#!/usr/bin/env node
import ts from "typescript";
import { jsxAttributeName } from "./lint-scope.mjs";
import { objectKeyName, reasonHit, runMarkupLint, walkNodes } from "./lib/markup-lint-ast.mjs";

// Bans imperative DOM construction in the Map. React owns the DOM there, so a
// string of HTML or a hand-built element bypasses the kit, the tokens and the
// surface registry, and nothing can say what is on screen. Every production
// .ts and .tsx file under packages/agent-shell/app/map/ is inspected, the kit
// included: nothing is exempt and nothing is grandfathered.

const EXTENSIONS = new Set([".ts", ".tsx"]);
const BANNED_MEMBERS = new Set(["innerHTML", "outerHTML", "insertAdjacentHTML", "appendChild", "dangerouslySetInnerHTML"]);
const BANNED_DOCUMENT_METHODS = new Set(["createElement", "createElementNS", "write"]);
const REMEDY = "Render through React and the kit under packages/agent-shell/app/map/ui/; the Map never builds DOM by hand (app/map/AGENTS.md).";

/** Returns the member a node reads, writes or declares: a property access, a string index, a JSX attribute or an object key. */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return jsxAttributeName(node) ?? objectKeyName(node);
}

/** True when an expression names the document object: `document` itself or a `.document` member. */
function isDocumentReceiver(receiver) {
  if (ts.isIdentifier(receiver)) return receiver.text === "document";
  return ts.isPropertyAccessExpression(receiver) && receiver.name.text === "document";
}

/** Returns the reason a node is imperative DOM, or null when it is not. */
function imperativeDomReason(node) {
  const member = memberName(node);
  if (member !== null && BANNED_MEMBERS.has(member)) return `${member} is imperative DOM`;
  if (ts.isPropertyAccessExpression(node) && BANNED_DOCUMENT_METHODS.has(node.name.text) && isDocumentReceiver(node.expression)) {
    return `document.${node.name.text} is imperative DOM`;
  }
  return null;
}

/** Collects every imperative DOM use in one parsed Map source. */
export function collectImperativeDom(sourceFile, file) {
  const hits = [];

  /** Records a node when it is imperative DOM. */
  function inspect(node) {
    const reason = imperativeDomReason(node);
    if (reason !== null) hits.push(reasonHit(sourceFile, file, node, reason));
  }

  walkNodes(sourceFile, inspect);
  return hits;
}

/** True for no path: nothing in the Map may build DOM by hand. */
function isExempt() {
  return false;
}

runMarkupLint({ name: "no-imperative-dom", extensions: EXTENSIONS, isExempt, collect: collectImperativeDom, remedy: REMEDY });
