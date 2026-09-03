#!/usr/bin/env node
// module-size lint: no production module over 400 lines.
//
// Runs from the repo root. Flags: --staged (only staged files), --root <dir>
// (treat <dir> as the repository root, used by the tests), and explicit paths.
// With no paths and no --staged, it lints the whole wider scope. A module is a
// source file the lint kit parses; test files are not production modules.
import { readFileSync } from "node:fs";
import path from "node:path";
import { isGrandfathered, parseLintArgs, reportLint, selectProductionSources } from "./lib/app-source-scope.mjs";

/**
 * Maximum lines a production module may hold. A longer module is split along
 * a named seam into modules with one purpose each. The limit rises
 * deliberately and rarely; a rising limit is usually a design smell.
 */
const MAX_MODULE_LINES = 400;

/**
 * Files in the wider scope that failed when this lint was introduced. This set
 * burns down to empty: when you next modify one of these files, split it and
 * remove it here. The strict scope is never listed and an entry for it is
 * ignored.
 */
const GRANDFATHERED_FILES = new Set([
  "packages/agent-shell/app/area-map-transaction-repository.mjs",
  "packages/agent-shell/app/area-map-world-index.mjs",
  "packages/agent-shell/app/area-resource-catalog.mjs",
  "packages/agent-shell/app/area-resource-mutations.mjs",
  "packages/agent-shell/app/area-resource-projection.mjs",
  "packages/agent-shell/app/area-resource-recovery.mjs",
  "packages/agent-shell/app/gateway.mjs",
  "packages/agent-shell/app/job-record.mjs",
  "packages/agent-shell/app/launch-environment.mjs",
  "packages/agent-shell/app/map-kinds.mjs",
  "packages/agent-shell/app/process-scheduler.mjs",
  "packages/agent-shell/app/public/area-board-core.js",
  "packages/agent-shell/app/public/area-directory-view.js",
  "packages/agent-shell/app/public/area-map-entities.js",
  "packages/agent-shell/app/public/area-map-figures.js",
  "packages/agent-shell/app/public/area-map-world-controller.js",
  "packages/agent-shell/app/public/area-map-world-core.js",
  "packages/agent-shell/app/public/area-map.js",
  "packages/agent-shell/app/public/document-comments.js",
  "packages/agent-shell/app/public/document-reader-controller.js",
  "packages/agent-shell/app/public/goal-launch-view.js",
  "packages/agent-shell/app/public/shell-coordinator.js",
  "packages/agent-shell/app/public/shell-event-bindings.js",
  "packages/agent-shell/app/public/shell.js",
  "packages/agent-shell/app/public/work-desk-view.js",
  "packages/agent-shell/app/server.mjs",
  "packages/agent-shell/app/work-source-adapters.mjs",
  "packages/agent-shell/app/work-table-harness.mjs"
]);

/** Counts the lines of a source text; a trailing newline does not start another line. */
function countLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split("\n").length;
  return source.endsWith("\n") ? lines - 1 : lines;
}

/** Returns the one hit for a module over the limit, or none. The hit points at the first line over it. */
function collectOversizedModule(root, repoPath) {
  if (isGrandfathered(repoPath, GRANDFATHERED_FILES)) return [];
  const lines = countLines(readFileSync(path.join(root, repoPath), "utf8"));
  if (lines <= MAX_MODULE_LINES) return [];
  return [{ path: repoPath, line: MAX_MODULE_LINES + 1, text: `module is ${lines} lines (max ${MAX_MODULE_LINES})` }];
}

/** Runs the module-size lint over the selected files and sets a failing exit code on any hit. */
function main() {
  const args = parseLintArgs(process.argv.slice(2));
  const files = selectProductionSources(args);
  const hits = files.flatMap((repoPath) => collectOversizedModule(args.root, repoPath));
  reportLint(
    "module-size",
    hits,
    `Split each module along a named seam into modules of at most ${MAX_MODULE_LINES} lines.`,
    files.length
  );
}

main();
