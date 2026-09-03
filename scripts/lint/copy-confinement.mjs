#!/usr/bin/env node
import ts from "typescript";
import { jsxAttributeName } from "./lint-scope.mjs";
import { UI_OWNER, jsxAttributeLiteral, reasonHit, reasonHitAt, renderedText, runMarkupLint, walkNodes } from "./lib/markup-lint-ast.mjs";

// Every sentence a person reads lives in packages/agent-shell/app/map/copy.ts,
// and only the kit renders words directly. In a feature .tsx file a JSX text
// node of two or more words, or a string literal of two or more words rendered
// as JSX children, is a hit. An aria-label or title string of any length is a
// hit too, because a label is copy. A word is a whitespace-separated token
// that contains a letter, so a separator such as a middle dot never counts.

const EXTENSIONS = new Set([".tsx"]);
const COPY_OWNER = "packages/agent-shell/app/map/copy.ts";
const COPY_ATTRIBUTES = new Set(["aria-label", "title"]);
const MIN_WORDS = 2;
const LOGICAL_OPERATORS = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
const REMEDY = `Move the words into ${COPY_OWNER} and pass them to a kit part under ${UI_OWNER}; feature markup renders no sentence of its own (app/map/AGENTS.md).`;

/** Counts the words in a text: whitespace-separated tokens that contain a letter. */
function countWords(text) {
  let words = 0;
  for (const token of text.split(/\s+/)) if (/\p{L}/u.test(token)) words += 1;
  return words;
}

/** True when an expression only wraps another: parentheses, `as`, `satisfies` or a non-null assertion. */
function isWrapper(expression) {
  return ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression);
}

/** Lists the string literals an expression can render as a child: through wrappers, conditionals and logical operators. */
function renderedLiterals(expression) {
  if (expression === undefined) return [];
  if (renderedText(expression) !== null) return [expression];
  if (isWrapper(expression)) return renderedLiterals(expression.expression);
  if (ts.isConditionalExpression(expression)) return [...renderedLiterals(expression.whenTrue), ...renderedLiterals(expression.whenFalse)];
  if (ts.isBinaryExpression(expression) && LOGICAL_OPERATORS.has(expression.operatorToken.kind)) {
    return [...renderedLiterals(expression.left), ...renderedLiterals(expression.right)];
  }
  return [];
}

/** True when a JSX expression sits among an element's or fragment's children rather than in an attribute. */
function isJsxChild(node) {
  return ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent));
}

/** Builds the hit for a JSX text node, anchored on its first word rather than on the preceding tag. */
function jsxTextHit(sourceFile, file, node, words) {
  const raw = sourceFile.text.slice(node.pos, node.end);
  const offset = Math.max(0, raw.search(/\S/));
  return reasonHitAt(sourceFile, file, node.pos + offset, `JSX text of ${words} words`);
}

/** Collects the literal children of one JSX expression that carry two or more words. */
function literalChildHits(sourceFile, file, node) {
  const hits = [];
  for (const literal of renderedLiterals(node.expression)) {
    const words = countWords(renderedText(literal));
    if (words >= MIN_WORDS) hits.push(reasonHit(sourceFile, file, literal, `string literal of ${words} words as JSX children`));
  }
  return hits;
}

/** Returns the hits one node produces: JSX text, literal children, or an aria-label or title string. */
function copyHits(sourceFile, file, node) {
  if (ts.isJsxText(node)) {
    const words = countWords(node.text);
    return words >= MIN_WORDS ? [jsxTextHit(sourceFile, file, node, words)] : [];
  }
  if (isJsxChild(node)) return literalChildHits(sourceFile, file, node);
  const name = jsxAttributeName(node);
  if (name === null || !COPY_ATTRIBUTES.has(name)) return [];
  const value = jsxAttributeLiteral(node);
  return value !== null && value.trim().length > 0 ? [reasonHit(sourceFile, file, node, `${name} string is copy`)] : [];
}

/** Collects every sentence a feature file renders on its own. */
export function collectFeatureCopy(sourceFile, file) {
  const hits = [];

  /** Records the copy one node renders directly. */
  function inspect(node) {
    hits.push(...copyHits(sourceFile, file, node));
  }

  walkNodes(sourceFile, inspect);
  return hits;
}

/** True for the copy owner and the kit, the only places that hold or render words. */
function isExempt(repoPath) {
  return repoPath === COPY_OWNER || repoPath.startsWith(UI_OWNER);
}

runMarkupLint({ name: "copy-confinement", extensions: EXTENSIONS, isExempt, collect: collectFeatureCopy, remedy: REMEDY });
