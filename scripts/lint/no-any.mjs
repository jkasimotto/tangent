#!/usr/bin/env node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { collectHits, listLintFiles, parseLintArgs, parseSourceFile, reportLint } from "./lint-scope.mjs";

// Forbids the `any` type in the Map. `: any`, `as any`, `<any>` and
// `Record<string, any>` all switch the type checker off for a value, so a
// mistake there surfaces at runtime instead of at typecheck. The lint walks the
// TypeScript AST and flags every `any` keyword, which covers those four forms
// and every other position where `any` is written as a type. Nothing is exempt.

const REMEDY = "Name the real type, or use `unknown` and narrow it at the boundary.";

/** True for a .ts or .tsx file, the only files where a type keyword can appear. */
function isTypeScriptFile(file) {
  return file.repoPath.endsWith(".ts") || file.repoPath.endsWith(".tsx");
}

/** True for an `any` keyword written as a type. */
function isAnyType(node) {
  return node.kind === ts.SyntaxKind.AnyKeyword;
}

/** Collects every `any` type in one file. */
export function collectAnyTypes(file) {
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  return collectHits(sourceFile, file, isAnyType);
}

/** Runs the no-any lint over the selected .ts and .tsx files. */
function main() {
  const files = listLintFiles(parseLintArgs(process.argv.slice(2))).filter(isTypeScriptFile);
  const hits = files.flatMap(collectAnyTypes);
  reportLint("no-any", hits, REMEDY, files.length);
}

main();
