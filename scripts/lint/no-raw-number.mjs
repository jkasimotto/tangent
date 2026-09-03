#!/usr/bin/env node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { collectHits, listLintFiles, parseLintArgs, parseSourceFile, reportLint } from "./lint-scope.mjs";

// Forbids the raw `number` type in the Map. Every numeric value carries a unit
// or a semantic brand (ScreenPx, ScenePx, SourcePx, Zoom, Milliseconds, Count,
// Index, Ratio), so a bare `number` never says nothing about what it measures.
// The brand owners under app/map/units/ are the only files where `number` is
// expected, because they are the files that define and construct the brands.
//
// The `T[number]` indexed-access operator is not a quantity and is never flagged.
// The strict scope has no grandfathered files.

/** Matches the brand owners: the direct .ts children of app/map/units/. */
const OWNER_FILE_PATTERN = /^packages\/agent-shell\/app\/map\/units\/[^/]+\.ts$/;

const REMEDY = "Rebrand each into a unit or semantic type (ScreenPx, ScenePx, Milliseconds, Count, Index, ...) from packages/agent-shell/app/map/units/.";

/** True for a .ts or .tsx file, the only files where a type keyword can appear. */
function isTypeScriptFile(file) {
  return file.repoPath.endsWith(".ts") || file.repoPath.endsWith(".tsx");
}

/** True for a `number` keyword that is the index of a `T[number]` indexed-access type, not a quantity. */
function isIndexedAccessOperator(node) {
  return node.parent !== undefined && ts.isIndexedAccessTypeNode(node.parent) && node.parent.indexType === node;
}

/** True for a `number` keyword used as a quantity type. */
function isRawNumberType(node) {
  return node.kind === ts.SyntaxKind.NumberKeyword && !isIndexedAccessOperator(node);
}

/** Collects every raw `number` type in one file; brand owners report nothing. */
export function collectRawNumbers(file) {
  if (OWNER_FILE_PATTERN.test(file.repoPath)) return [];
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  return collectHits(sourceFile, file, isRawNumberType);
}

/** Runs the no-raw-number lint over the selected .ts and .tsx files. */
function main() {
  const files = listLintFiles(parseLintArgs(process.argv.slice(2))).filter(isTypeScriptFile);
  const hits = files.flatMap(collectRawNumbers);
  reportLint("no-raw-number", hits, REMEDY, files.length);
}

main();
