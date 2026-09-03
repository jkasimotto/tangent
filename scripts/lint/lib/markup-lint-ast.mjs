import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import ts from "typescript";
import { isStrictScopeFile, listLintFiles, literalText, parseLintArgs, parseSourceFile, reportLint } from "../lint-scope.mjs";

// Shared AST helpers and the runner for the four markup-family lints:
// no-imperative-dom, no-raw-interactive-elements, surface-confinement and
// copy-confinement. They walk the TypeScript AST with JSX, so a banned name
// inside a comment or a string is never a hit. Selection, parsing and the
// report shape come from lint-scope.mjs. The four inspect the Map alone: the
// lint sources under scripts/lint/ quote the very names they ban, and test
// files are not UI. This module lives under lib/ so run-pool.mjs, which runs
// every .mjs directly under scripts/lint/, does not treat it as a lint.

export const MAP_ROOT = "packages/agent-shell/app/map/";
export const UI_OWNER = "packages/agent-shell/app/map/ui/";
const ECHOED_LINE_LIMIT = 120;

/** Trims a source line and shortens it to the echo limit, so a hit on a long JSX line stays one readable line. */
function echoedLine(text) {
  const trimmed = text.trim();
  return trimmed.length > ECHOED_LINE_LIMIT ? `${trimmed.slice(0, ECHOED_LINE_LIMIT)}...` : trimmed;
}

/** Builds one report hit at a source position with the reason in front of the echoed source line. */
export function reasonHitAt(sourceFile, file, position, reason) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(position);
  const text = sourceFile.text.split("\n")[line] ?? "";
  return { repoPath: file.repoPath, line: line + 1, text: `${reason}: ${echoedLine(text)}` };
}

/** Builds one report hit for a node, anchored on the node's first token. */
export function reasonHit(sourceFile, file, node, reason) {
  return reasonHitAt(sourceFile, file, node.getStart(sourceFile), reason);
}

/** Visits every node of a source file in document order. */
export function walkNodes(sourceFile, onNode) {
  /** Visits one node, then its children. */
  function visit(node) {
    onNode(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

/** Returns the fixed text that follows one template substitution. */
function templateSpanText(span) {
  return span.literal.text;
}

/** Returns the text a node renders as a literal: a string, a plain template, or a template's fixed parts joined by spaces. */
export function renderedText(node) {
  if (node !== undefined && ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(templateSpanText)].join(" ");
  return literalText(node);
}

/** Returns the literal text of a JSX attribute's value, or null when it has none or the value is computed. */
export function jsxAttributeLiteral(attribute) {
  const initializer = attribute.initializer;
  if (initializer === undefined) return null;
  if (ts.isJsxExpression(initializer)) return renderedText(initializer.expression);
  return renderedText(initializer);
}

/** Returns the key an object literal property declares, or null for computed keys and other nodes. */
export function objectKeyName(node) {
  if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

/** Runs one markup lint end to end: selects Map sources, parses each, gathers the rule's hits, and reports. */
export function runMarkupLint({ name, extensions, isExempt, collect, remedy }) {
  const parsed = parseLintArgs(process.argv.slice(2));

  /** True for a production Map source with a linted extension that exists and no exempt owner claims. */
  function isInspected(file) {
    const repoPath = file.repoPath;
    if (!repoPath.startsWith(MAP_ROOT) || !isStrictScopeFile(repoPath) || !extensions.has(extname(repoPath).toLowerCase())) return false;
    return !isExempt(repoPath) && existsSync(file.absolutePath);
  }

  const files = listLintFiles(parsed).filter(isInspected);
  const hits = [];
  for (const file of files) {
    const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
    hits.push(...collect(sourceFile, file));
  }
  reportLint(name, hits, remedy, files.length);
}
