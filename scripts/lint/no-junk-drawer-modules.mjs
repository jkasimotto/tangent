#!/usr/bin/env node
import path from "node:path";
import { WIDER_SCOPE, parseLintArgs, reportLint, resolveLintFiles } from "./wider-scope.mjs";

// Enforces the Map rule "No file named utils, helpers, common or misc" (app/map/AGENTS.md, and the
// lint table in docs/design/area-map-rebuild/code.md). A file with one of those names declares no
// owner: it accretes whatever its next caller could not place. The right home is a module named
// after the one job it does. Filenames only: a directory may carry any name.
//
// GRANDFATHERED_FILES are the wider-scope offenders at introduction. It burns down to empty.

/** Basenames, extension stripped, that declare no owner and are banned. */
const JUNK_BASENAMES = new Set(["utils", "util", "helpers", "helper", "common", "misc"]);

/** Wider-scope files that already carried a junk name when this lint was introduced. Burns down to empty. */
const GRANDFATHERED_FILES = new Set([]);

/** Returns the basename of a repo path with everything from its first dot stripped. */
function stemOf(repoPath) {
  const base = path.basename(repoPath);
  const dot = base.indexOf(".");
  return (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
}

/** Returns whether a repo path's basename is one of the banned ownerless names. */
function isJunkDrawerFile(repoPath) {
  return JUNK_BASENAMES.has(stemOf(repoPath));
}

/** Turns one offending repo path into a report hit on its first line. */
function hitFor(repoPath) {
  return { path: repoPath, line: 1, text: `"${stemOf(repoPath)}" names no owner` };
}

/** Runs the no-junk-drawer-modules lint over the wider scope. */
function main() {
  const args = parseLintArgs(process.argv.slice(2));
  const files = resolveLintFiles(args, WIDER_SCOPE).filter((repoPath) => !GRANDFATHERED_FILES.has(repoPath));
  const hits = files.filter(isJunkDrawerFile).map(hitFor);
  reportLint(
    "no-junk-drawer-modules",
    hits,
    "Name the module after the one job it owns; utils, helpers, common and misc declare no owner.",
    `${files.length} file(s) checked`
  );
}

main();
