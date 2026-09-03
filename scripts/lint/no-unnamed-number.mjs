#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { collectHits, isStrictScopeFile, listLintFiles, parseLintArgs, parseSourceFile, reportLint } from "./lint-scope.mjs";

// Bans unnamed numeric literals in the Map. Every number the Map uses is a
// named unit or layout token, so a reader never has to guess what `16` or
// `960` measures. The only literals allowed everywhere are 0, 1 and -1, plus
// 2 as a direct operand of multiplication or division (midpoints, doubling).
// Every other literal lives in one of the OWNER paths below. The strict scope
// is never grandfathered, so this lint carries no ratchet. Selection, parsing
// and the report shape come from lint-scope.mjs.

const LINT_NAME = "no-unnamed-number";
const REMEDY = "Name each one as a unit in packages/agent-shell/app/map/units/ or a layout token in packages/agent-shell/app/map/layout/layout-tokens.ts and use the name here.";

// Files and directories whose job is to name numbers. A literal is expected here.
const OWNER_DIRECTORIES = ["packages/agent-shell/app/map/units/"];
const OWNER_FILES = new Set(["packages/agent-shell/app/map/layout/layout-tokens.ts"]);

// The lint scripts themselves are counted out: they name their own limits.
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// Literal values every file may use without naming them.
const FREE_VALUES = new Set([0, 1, -1]);
const HALVING_OR_DOUBLING_VALUE = 2;
const SCALING_OPERATORS = new Set([
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken
]);

/** Returns whether a repo-relative path is one of the files allowed to hold unnamed numbers. */
function isOwnerFile(repoPath) {
  if (OWNER_FILES.has(repoPath)) return true;
  return OWNER_DIRECTORIES.some((directory) => repoPath.startsWith(directory));
}

/** Returns whether a lint file is an existing strict-scope source with a linted extension that no owner claims. */
function isLintedFile(file) {
  const repoPath = file.repoPath;
  if (!isStrictScopeFile(repoPath) || !EXTENSIONS.has(path.extname(repoPath).toLowerCase()) || isOwnerFile(repoPath)) return false;
  return existsSync(file.absolutePath) && statSync(file.absolutePath).isFile();
}

/** Returns the numeric value of a numeric or bigint literal node, honouring separators and radix prefixes. */
function literalValue(node) {
  const text = node.text.replace(/_/g, "").replace(/n$/, "");
  return Number(text);
}

/** Returns the signed value of a literal, folding a directly enclosing unary minus into it. */
function signedLiteralValue(node) {
  const value = literalValue(node);
  const parent = node.parent;
  if (parent && ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.MinusToken) {
    return -value;
  }
  return value;
}

/** Returns whether a literal is the 2 in a halving or doubling, a direct operand of `*` or `/`. */
function isHalvingOrDoubling(node) {
  if (literalValue(node) !== HALVING_OR_DOUBLING_VALUE) return false;
  const parent = node.parent;
  return Boolean(parent) && ts.isBinaryExpression(parent) && SCALING_OPERATORS.has(parent.operatorToken.kind);
}

/** Returns whether a literal node is one every file may hold without naming it. */
function isAllowedLiteral(node) {
  return FREE_VALUES.has(signedLiteralValue(node)) || isHalvingOrDoubling(node);
}

/** Returns whether a node is a numeric literal in the sense of this lint. */
function isNumberLiteral(node) {
  return ts.isNumericLiteral(node) || ts.isBigIntLiteral(node);
}

/** Returns whether a node is a numeric literal that must be named. */
function isUnnamedNumber(node) {
  return isNumberLiteral(node) && !isAllowedLiteral(node);
}

/** Collects every unnamed numeric literal in one file. */
function collectUnnamedNumbers(file) {
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  return collectHits(sourceFile, file, isUnnamedNumber);
}

/** Runs the lint over the selected files and reports the outcome. */
function main() {
  const files = listLintFiles(parseLintArgs(process.argv.slice(2))).filter(isLintedFile);
  const hits = files.flatMap(collectUnnamedNumbers);
  reportLint(LINT_NAME, hits, REMEDY, files.length);
}

main();
