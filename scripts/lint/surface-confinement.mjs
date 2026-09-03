#!/usr/bin/env node
import ts from "typescript";
import { jsxAttributeName, literalText } from "./lint-scope.mjs";
import { UI_OWNER, jsxAttributeLiteral, objectKeyName, reasonHit, runMarkupLint, walkNodes } from "./lib/markup-lint-ast.mjs";

// Every Map surface is declared once in the surface registry and rendered by
// ui/Surface.tsx, which is the only place that renders a dialog role, marks a
// surface modal, or moves focus. A feature that does any of those itself
// escapes the surface stack, so role="dialog", role="alertdialog", aria-modal,
// autoFocus and a .focus( call are hits anywhere outside the kit, in .ts as
// well as .tsx, whether written as JSX, as an object key, or via setAttribute.

const EXTENSIONS = new Set([".ts", ".tsx"]);
const DIALOG_ROLES = new Set(["dialog", "alertdialog"]);
const REMEDY = `Declare the surface in surfaces/surface-registry.ts and render it through ${UI_OWNER}Surface.tsx; only the kit owns dialog roles, aria-modal, autoFocus and focus calls (app/map/AGENTS.md).`;

/** Returns the reason an attribute or object key is a surface concern: a dialog role, aria-modal or autoFocus. */
function surfaceAttributeReason(name, value) {
  if (name === null) return null;
  if (name === "role") return value !== null && DIALOG_ROLES.has(value) ? `role="${value}" outside the kit` : null;
  if (name === "aria-modal") return "aria-modal outside the kit";
  if (name.toLowerCase() === "autofocus") return "autoFocus outside the kit";
  return null;
}

/** Returns the method name a call reaches through a property or a string index, or null. */
function calledMethod(callee) {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee)) return literalText(callee.argumentExpression);
  return null;
}

/** Returns the reason a call is a surface concern: a .focus( call, or setAttribute of a dialog role or aria-modal. */
function surfaceCallReason(node) {
  if (!ts.isCallExpression(node)) return null;
  const method = calledMethod(node.expression);
  if (method === "focus") return ".focus( call outside the kit";
  if (method !== "setAttribute") return null;
  return surfaceAttributeReason(literalText(node.arguments[0]), literalText(node.arguments[1]));
}

/** Returns the reason a node is a surface concern, or null when it is not. */
function surfaceReason(node) {
  if (ts.isJsxAttribute(node)) return surfaceAttributeReason(jsxAttributeName(node), jsxAttributeLiteral(node));
  const key = objectKeyName(node);
  if (key !== null) return surfaceAttributeReason(key, ts.isPropertyAssignment(node) ? literalText(node.initializer) : null);
  return surfaceCallReason(node);
}

/** Collects every surface concern in one parsed feature file. */
export function collectSurfaceConcerns(sourceFile, file) {
  const hits = [];

  /** Records a node when it renders a dialog, marks a modal, or moves focus. */
  function inspect(node) {
    const reason = surfaceReason(node);
    if (reason !== null) hits.push(reasonHit(sourceFile, file, node, reason));
  }

  walkNodes(sourceFile, inspect);
  return hits;
}

/** True inside the kit, the one owner of dialogs, modality and focus. */
function isExempt(repoPath) {
  return repoPath.startsWith(UI_OWNER);
}

runMarkupLint({ name: "surface-confinement", extensions: EXTENSIONS, isExempt, collect: collectSurfaceConcerns, remedy: REMEDY });
