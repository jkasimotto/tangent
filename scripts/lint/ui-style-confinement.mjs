#!/usr/bin/env node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { jsxAttributeName, literalText, parseSourceFile } from "./lint-scope.mjs";
import {
  MAP_ROOT_COMPONENT,
  UI_OWNER,
  isMapStyleFile,
  jsxTagName,
  lineOf,
  reasonHit,
  runStyleLint
} from "./style-scope.mjs";

// Confines styling to the Map's kit. packages/agent-shell/app/map/ui/ is the one owner of CSS.
// Outside it a .css file, a <style> element, a style= attribute, an element.style write, a
// setAttribute("style") call and a setProperty("--...") call are all banned. The one exception is
// MapRoot.tsx, which emits the layout tokens as --tangent-map-* custom properties on the root
// element (docs/design/area-map-rebuild/code.md, Layout tokens). The strict scope is never
// grandfathered, so there is no ratchet.

const NAME = "ui-style-confinement";
const EXTENSIONS = new Set([".css", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const LAYOUT_TOKEN_PREFIX = "--tangent-map-";
const REMEDY = `Styling belongs to ${UI_OWNER}. Compose kit parts instead of writing CSS in a feature; MapRoot.tsx may only set ${LAYOUT_TOKEN_PREFIX}* custom properties.`;

/** True for the files this lint inspects: production Map sources outside the kit. */
function isInspected(repoPath) {
  return isMapStyleFile(repoPath, EXTENSIONS) && !repoPath.startsWith(UI_OWNER);
}

/** True when every key of a style object literal is a --tangent-map-* custom property. */
function onlyLayoutTokenKeys(objectLiteral) {
  return objectLiteral.properties.every((property) => {
    const key = property.name;
    return Boolean(key) && ts.isStringLiteral(key) && key.text.startsWith(LAYOUT_TOKEN_PREFIX);
  });
}

/** Returns why a style= attribute is banned, or null when MapRoot emits only layout tokens. */
function checkStyleAttribute(node, isMapRoot) {
  if (!isMapRoot) return "an inline style= attribute";
  const initializer = node.initializer;
  if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return null;
  const expression = initializer.expression;
  if (ts.isObjectLiteralExpression(expression) && !onlyLayoutTokenKeys(expression)) {
    return `MapRoot may only set ${LAYOUT_TOKEN_PREFIX}* custom properties inline`;
  }
  return null;
}

/** Returns why a `.style.` or `.style[` access is banned, or null when it is not a write chain. */
function checkStyleAccess(node, isMapRoot) {
  const parent = node.parent;
  const chained =
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
  if (!chained) return null;
  const isSetProperty = ts.isPropertyAccessExpression(parent) && parent.name.text === "setProperty";
  if (isMapRoot && isSetProperty) return null;
  return "an element.style write";
}

/** Returns why a setProperty("--...") or setAttribute("style") call is banned, or null. */
function checkCall(node, isMapRoot) {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const firstArgument = literalText(node.arguments[0]);
  if (callee.name.text === "setAttribute" && firstArgument === "style") return "a style attribute write";
  if (callee.name.text !== "setProperty" || firstArgument === null || !firstArgument.startsWith("--")) return null;
  if (isMapRoot && firstArgument.startsWith(LAYOUT_TOKEN_PREFIX)) return null;
  return "a CSS custom-property write";
}

/** Returns the reason one AST node violates style confinement, or null when it is fine. */
function checkNode(node, isMapRoot) {
  if (jsxTagName(node) === "style") return "a <style> element";
  if (jsxAttributeName(node) === "style") return checkStyleAttribute(node, isMapRoot);
  if (ts.isPropertyAccessExpression(node) && node.name.text === "style") return checkStyleAccess(node, isMapRoot);
  if (ts.isCallExpression(node)) return checkCall(node, isMapRoot);
  return null;
}

/** Scans one script file's AST for style writes and returns one hit per offending line. */
function collectScriptHits(file, source) {
  const sourceFile = parseSourceFile(file, source);
  const isMapRoot = file.repoPath === MAP_ROOT_COMPONENT;
  const lines = source.split("\n");
  const byLine = new Map();

  /** Visits one node, records the first reason on its line, then descends. */
  const visit = (node) => {
    const reason = checkNode(node, isMapRoot);
    if (reason !== null) {
      const line = lineOf(sourceFile, node);
      if (!byLine.has(line)) byLine.set(line, reasonHit(file, line, reason, lines[line - 1] ?? ""));
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...byLine.values()];
}

/** Scans one file: a .css file is a hit by itself, a script file is walked for style writes. */
function collectFileHits(file) {
  if (file.repoPath.endsWith(".css")) return [reasonHit(file, 1, `a .css file outside ${UI_OWNER}`, "")];
  return collectScriptHits(file, readFileSync(file.absolutePath, "utf8"));
}

runStyleLint({ name: NAME, remedy: REMEDY, isInspected, collectFileHits });
