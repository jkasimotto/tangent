#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { WIDER_SCOPE, isSourceFile, parseLintArgs, reportLint, resolveLintFiles } from "./wider-scope.mjs";

// Enforces the Map rule "No function with more than 7 parameters" (app/map/AGENTS.md, and the
// lint table in docs/design/area-map-rebuild/code.md). A long positional list is unreadable at the
// call site, where the order lives only in the reader's memory, and it grows one parameter at a
// time, so it needs a ratchet rather than a review note. A destructured object parameter counts as
// one parameter, which is exactly the sanctioned fix.
//
// GRANDFATHERED_FILES are the wider-scope offenders at introduction. It burns down to empty: remove
// a file once its functions take a typed object, and never add a file under app/map/.

const MAX_PARAMETERS = 7;

/** Wider-scope files that already exceeded the cap when this lint was introduced. Burns down to empty. */
const GRANDFATHERED_FILES = new Set([
  "packages/agent-shell/app/attempt-state.mjs",
  "packages/agent-shell/app/server.mjs"
]);

/** Maps a source path to the TypeScript parser script kind. */
function scriptKindOf(repoPath) {
  const extension = path.extname(repoPath).toLowerCase();
  if (extension === ".tsx" || extension === ".jsx") return ts.ScriptKind.TSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Returns whether a node declares a parameter list of its own. */
function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/** Returns whether a parameter is TypeScript's fake `this` parameter, which is a type annotation and not an argument. */
function isThisParameter(parameter) {
  return ts.isIdentifier(parameter.name) && parameter.name.text === "this";
}

/** Counts the arguments a function takes; a destructured object parameter counts as one. */
function countParameters(node) {
  return node.parameters.filter((parameter) => !isThisParameter(parameter)).length;
}

/** Returns the best readable name for a function-like node, falling back to the declaration it is assigned to. */
function nameOf(node) {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return "(anonymous)";
}

/** Collects every function in one file whose parameter count exceeds the cap. */
function collectLongParameterLists(root, repoPath) {
  const sourceText = readFileSync(path.join(root, repoPath), "utf8");
  const sourceFile = ts.createSourceFile(repoPath, sourceText, ts.ScriptTarget.Latest, true, scriptKindOf(repoPath));
  const hits = [];

  /** Visits one AST node and records it when its parameter list is too long. */
  const visit = (node) => {
    if (isFunctionLike(node)) {
      const count = countParameters(node);
      if (count > MAX_PARAMETERS) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        hits.push({ path: repoPath, line: line + 1, text: `${nameOf(node)} takes ${count} parameters (max ${MAX_PARAMETERS})` });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return hits;
}

/** Splits linted files into grandfathered ones, which only get a burn-down note, and enforced ones. */
function partitionByRatchet(files) {
  const enforced = files.filter((repoPath) => !GRANDFATHERED_FILES.has(repoPath));
  const grandfathered = files.filter((repoPath) => GRANDFATHERED_FILES.has(repoPath));
  return { enforced, grandfathered };
}

/** Runs the no-long-param-list lint over the wider scope. */
function main() {
  const args = parseLintArgs(process.argv.slice(2));
  const files = resolveLintFiles(args, WIDER_SCOPE).filter(isSourceFile);
  const { enforced, grandfathered } = partitionByRatchet(files);

  for (const repoPath of grandfathered) {
    if (collectLongParameterLists(args.root, repoPath).length === 0) {
      console.log(`note: ${repoPath} is clean, remove it from GRANDFATHERED_FILES`);
    }
  }

  const hits = enforced.flatMap((repoPath) => collectLongParameterLists(args.root, repoPath));
  reportLint(
    "no-long-param-list",
    hits,
    "Pass one typed object whose fields name each value instead of a positional list.",
    `${enforced.length} file(s) checked, ${grandfathered.length} grandfathered`
  );
}

main();
