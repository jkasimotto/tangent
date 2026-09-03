#!/usr/bin/env node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { collectHits, listLintFiles, literalText, parseLintArgs, parseSourceFile, reportLint } from "./lint-scope.mjs";

// Confines the untyped kernel to one door. Only kernel/ imports ../public/*.js; it brands every
// value on the way in and exports typed signatures. Everything else reaches the kernel through
// kernel/kernel-boundary.ts, so an unbranded number or id cannot leak past the boundary.

const KERNEL_DIRECTORY = "packages/agent-shell/app/map/kernel/";
const PUBLIC_SEGMENT = "/public/";

/** Returns the module specifier of a static import or re-export, or null. */
function staticSpecifier(node) {
  if (ts.isImportDeclaration(node)) return literalText(node.moduleSpecifier);
  if (ts.isExportDeclaration(node)) return literalText(node.moduleSpecifier);
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return literalText(node.moduleReference.expression);
  }
  return null;
}

/** Returns the module specifier of a dynamic import() or require() call, or null. */
function dynamicSpecifier(node) {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(callee) && callee.text === "require";
  if (!isImport && !isRequire) return null;
  return literalText(node.arguments[0]);
}

/** True when a node imports a module whose specifier crosses into a public/ directory. */
function importsPublicModule(node) {
  const specifier = staticSpecifier(node) ?? dynamicSpecifier(node);
  return specifier !== null && specifier.includes(PUBLIC_SEGMENT);
}

/** Reports every public/ import in a file outside the kernel directory. */
function collectFileHits(file) {
  if (file.repoPath.startsWith(KERNEL_DIRECTORY)) return [];
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  return collectHits(sourceFile, file, importsPublicModule);
}

/** Runs kernel boundary confinement over the strict scope, the staged files, or explicit paths. */
function main() {
  const files = listLintFiles(parseLintArgs(process.argv.slice(2)));
  const hits = files.flatMap(collectFileHits);
  reportLint(
    "kernel-boundary-confinement",
    hits,
    `Import the typed export from ${KERNEL_DIRECTORY}kernel-boundary.ts instead of reaching into public/ directly.`,
    files.length
  );
}

main();
