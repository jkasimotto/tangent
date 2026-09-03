#!/usr/bin/env node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { collectHits, listLintFiles, parseLintArgs, parseSourceFile, reportLint } from "./lint-scope.mjs";

// Confines writes of Excalidraw's selection to two owners. The subordination module turns a press
// meaning into the selection Excalidraw must hold before its first move frame, and the projection
// applies it. Any other file may read selectedElementIds but may not assign it or build an
// object carrying it, so no second module can correct Excalidraw's selection behind them.

const OWNERS = new Set([
  "packages/agent-shell/app/map/input/excalidraw-subordination.ts",
  "packages/agent-shell/app/map/canvas/projection.ts"
]);
const FIELD = "selectedElementIds";

/** True when a property name node, identifier or string literal, names the selection field. */
function namesField(nameNode) {
  if (nameNode === undefined) return false;
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) return nameNode.text === FIELD;
  return false;
}

/** True when an expression accesses the selection field through a dot or a literal index. */
function accessesField(node) {
  if (ts.isPropertyAccessExpression(node)) return namesField(node.name);
  if (ts.isElementAccessExpression(node)) return namesField(node.argumentExpression);
  return false;
}

/** True for any assignment, plain or compound, whose target is the selection field. */
function isFieldAssignment(node) {
  if (!ts.isBinaryExpression(node)) return false;
  const kind = node.operatorToken.kind;
  if (kind < ts.SyntaxKind.FirstAssignment || kind > ts.SyntaxKind.LastAssignment) return false;
  return accessesField(node.left);
}

/** True for `{ selectedElementIds: ... }` or `{ selectedElementIds }` inside an object literal. */
function isFieldObjectKey(node) {
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) return namesField(node.name);
  return false;
}

/** Reports every selection write in a file that is not one of the two owners. */
function collectFileHits(file) {
  if (OWNERS.has(file.repoPath)) return [];
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  return collectHits(sourceFile, file, (node) => isFieldAssignment(node) || isFieldObjectKey(node));
}

/** Runs selection write confinement over the strict scope, the staged files, or explicit paths. */
function main() {
  const files = listLintFiles(parseLintArgs(process.argv.slice(2)));
  const hits = files.flatMap(collectFileHits);
  reportLint(
    "selection-write-confinement",
    hits,
    `Express the selection as a PressMeaning and let ${[...OWNERS].join(" or ")} write ${FIELD}.`,
    files.length
  );
}

main();
