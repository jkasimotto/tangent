#!/usr/bin/env node
// function-size lint: no function over 80 lines, signature through closing brace.
//
// Runs from the repo root. Flags: --staged (only staged files), --root <dir>
// (treat <dir> as the repository root, used by the tests), and explicit paths.
// With no paths and no --staged, it lints the whole wider scope.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isGrandfathered, parseLintArgs, reportLint, selectProductionSources } from "./lib/app-source-scope.mjs";

/**
 * Maximum source lines a function may span from its signature to its closing
 * brace. A longer function is split into smaller named units. The limit rises
 * deliberately and rarely; a rising limit is usually a design smell.
 */
const MAX_FUNCTION_LINES = 80;

/**
 * Files in the wider scope that failed when this lint was introduced. This set
 * burns down to empty: when you next modify one of these files, split its
 * oversized functions and remove it here. The strict scope is never listed and
 * an entry for it is ignored.
 */
const GRANDFATHERED_FILES = new Set([
  "packages/agent-shell/app/area-canvas-repository.mjs",
  "packages/agent-shell/app/area-map-transaction-repository.mjs",
  "packages/agent-shell/app/area-map-world-index.mjs",
  "packages/agent-shell/app/area-resource-catalog.mjs",
  "packages/agent-shell/app/area-resource-mutations.mjs",
  "packages/agent-shell/app/area-resource-observations.mjs",
  "packages/agent-shell/app/area-resource-projection.mjs",
  "packages/agent-shell/app/area-resource-representations.mjs",
  "packages/agent-shell/app/area-resource-service.mjs",
  "packages/agent-shell/app/brain-routes.mjs",
  "packages/agent-shell/app/document-routes.mjs",
  "packages/agent-shell/app/gateway.mjs",
  "packages/agent-shell/app/job-routes.mjs",
  "packages/agent-shell/app/launch-catalog.mjs",
  "packages/agent-shell/app/map-kinds.mjs",
  "packages/agent-shell/app/message-delivery.mjs",
  "packages/agent-shell/app/pane-observer.mjs",
  "packages/agent-shell/app/pipeline-routes.mjs",
  "packages/agent-shell/app/process-scheduler.mjs",
  "packages/agent-shell/app/public/action-telemetry.js",
  "packages/agent-shell/app/public/area-board-core.js",
  "packages/agent-shell/app/public/area-board.js",
  "packages/agent-shell/app/public/area-brain-pane.js",
  "packages/agent-shell/app/public/area-directory-view.js",
  "packages/agent-shell/app/public/area-map-pane.js",
  "packages/agent-shell/app/public/area-map-world-controller.js",
  "packages/agent-shell/app/public/area-map-world-core.js",
  "packages/agent-shell/app/public/area-map.js",
  "packages/agent-shell/app/public/document-comments.js",
  "packages/agent-shell/app/public/document-reader-controller.js",
  "packages/agent-shell/app/public/document-reader-view.js",
  "packages/agent-shell/app/public/go-to-rows.js",
  "packages/agent-shell/app/public/goal-launch-view.js",
  "packages/agent-shell/app/public/program-view.js",
  "packages/agent-shell/app/public/refresh-lifecycle.js",
  "packages/agent-shell/app/public/shell-coordinator.js",
  "packages/agent-shell/app/public/shell-event-bindings.js",
  "packages/agent-shell/app/public/shell.js",
  "packages/agent-shell/app/public/split-workspace-controller.js",
  "packages/agent-shell/app/public/terminal-controller.js",
  "packages/agent-shell/app/public/terminal-selection.js",
  "packages/agent-shell/app/public/work-desk-view.js",
  "packages/agent-shell/app/public/work-search-bar.js",
  "packages/agent-shell/app/server.mjs",
  "packages/agent-shell/app/session-ownership.mjs",
  "packages/agent-shell/app/terminal-transport.mjs",
  "packages/agent-shell/app/vault-repository.mjs",
  "packages/agent-shell/app/work-model.mjs",
  "packages/agent-shell/app/work-publisher.mjs",
  "packages/agent-shell/app/work-source-adapters.mjs",
  "packages/agent-shell/app/work-store.mjs",
  "packages/agent-shell/app/work-table-harness.mjs"
]);

/** Maps a source path to the parser script kind so JSX and TSX parse correctly. */
function scriptKindFor(repoPath) {
  const extension = path.extname(repoPath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** True for function-like nodes that carry a body and so have a measurable size. */
function isMeasurableFunction(node) {
  if (ts.isFunctionDeclaration(node)) return Boolean(node.body);
  return (
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

/** Returns the readable text of a property-like key, or undefined when it is computed. */
function keyName(name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  return undefined;
}

/** Best human-readable name for a function-like node, or "(anonymous)". */
function functionName(node) {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    return keyName(node.name) ?? "(anonymous)";
  }
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))) {
    return keyName(parent.name) ?? "(anonymous)";
  }
  return "(anonymous)";
}

/** Measures a node's line span from its first token, after leading comments, to its end. */
function lineSpan(sourceFile, node) {
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;
  return { startLine: startLine + 1, lines: endLine - startLine + 1 };
}

/** Collects the functions in one file whose line span exceeds the limit. */
function collectOversizedFunctions(root, repoPath) {
  if (isGrandfathered(repoPath, GRANDFATHERED_FILES)) return [];
  const source = readFileSync(path.join(root, repoPath), "utf8");
  const sourceFile = ts.createSourceFile(repoPath, source, ts.ScriptTarget.Latest, true, scriptKindFor(repoPath));
  const hits = [];

  /** Visits one node, records it when it is an oversized function, and descends. */
  const visit = (node) => {
    if (isMeasurableFunction(node)) {
      const { startLine, lines } = lineSpan(sourceFile, node);
      if (lines > MAX_FUNCTION_LINES) {
        hits.push({ path: repoPath, line: startLine, text: `${functionName(node)} is ${lines} lines (max ${MAX_FUNCTION_LINES})` });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return hits;
}

/** Runs the function-size lint over the selected files and sets a failing exit code on any hit. */
function main() {
  const args = parseLintArgs(process.argv.slice(2));
  const files = selectProductionSources(args);
  const hits = files.flatMap((repoPath) => collectOversizedFunctions(args.root, repoPath));
  reportLint(
    "function-size",
    hits,
    `Split each into smaller named functions of at most ${MAX_FUNCTION_LINES} lines.`,
    files.length
  );
}

main();
