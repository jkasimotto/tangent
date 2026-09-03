#!/usr/bin/env node
// Confines identifier guards to the wire registry. Every value the server mints
// and later guards is registered as a pair, minter beside guard, in
// packages/agent-shell/app/public/area-map-wire-values.js. A regular-expression
// literal shaped like an identifier guard anywhere else is a guard without a
// minter, so this lint bans it there.
//
// An id-shaped literal starts with `^[` or `^\w`, ends with `$`, is printable
// ASCII, repeats at least one atom, and has no wildcard dot or capturing group.
// That shape matches `/^[a-z0-9-]+$/` and the UUID guards while leaving
// single-key guards like `/^[hjkl]$/` and rewrites like `/^["'](.*)["']$/` alone.
//
// Scope is packages/agent-shell/app/** production sources. The Map is strict;
// the rest of the app ratchets down through GRANDFATHERED_FILES. The lint kit
// is not linted because this file quotes the very shape it bans. Selection
// comes from wider-scope.mjs, parsing and the report shape from lint-scope.mjs.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { collectHits, parseLintArgs, parseSourceFile, reportLint } from "./lint-scope.mjs";
import { resolveLintFiles } from "./wider-scope.mjs";

const LINT_NAME = "wire-guard-confinement";
const WIDE_SCOPE = ["packages/agent-shell/app"];
const REGISTRY_FILE = "packages/agent-shell/app/public/area-map-wire-values.js";
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx"]);
const REMEDY = `Register the guard beside its minter in ${REGISTRY_FILE} and import it from there.`;

/** Files that failed when the lint was introduced. This set burns down to empty; never add to it. */
const GRANDFATHERED_FILES = new Set([
  "packages/agent-shell/app/action-telemetry.mjs",
  "packages/agent-shell/app/area-resource-catalog.mjs",
  "packages/agent-shell/app/area-resource-observations.mjs",
  "packages/agent-shell/app/goal-cards.mjs",
  "packages/agent-shell/app/map-kinds.mjs",
  "packages/agent-shell/app/process-note.mjs",
  "packages/agent-shell/app/programs.mjs",
  "packages/agent-shell/app/public/action-telemetry.js",
  "packages/agent-shell/app/server.mjs",
  "packages/agent-shell/app/session-ownership.mjs"
]);

/** Returns whether a repo path is a parseable source module that is neither a declaration file nor exempt. */
function isInspectedSource(repoPath) {
  const base = path.basename(repoPath);
  if (base.endsWith(".d.ts") || !SOURCE_EXTENSIONS.has(path.extname(base).toLowerCase())) return false;
  return repoPath !== REGISTRY_FILE && !GRANDFATHERED_FILES.has(repoPath);
}

/** Turns the repo paths a run covers into lint files, keeping the inspected ones that exist on disk. */
function selectFiles(parsed) {
  return resolveLintFiles(parsed, WIDE_SCOPE)
    .filter(isInspectedSource)
    .map((repoPath) => ({ absolutePath: path.join(parsed.root, repoPath), repoPath }))
    .filter((file) => existsSync(file.absolutePath) && statSync(file.absolutePath).isFile());
}

/** Strips the pattern body out of a regular-expression literal's text, dropping the slashes and flags. */
function patternOf(literalText) {
  const lastSlash = literalText.lastIndexOf("/");
  return literalText.slice(1, lastSlash);
}

/** Returns whether a pattern contains a capturing group, which marks a rewrite rather than a guard. */
function hasCapturingGroup(pattern) {
  return /(^|[^\\])\((?!\?)/.test(pattern);
}

/** Returns whether a pattern uses the wildcard dot outside a character class. */
function hasWildcardDot(pattern) {
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      index += 1;
    } else if (inClass) {
      if (char === "]") inClass = false;
    } else if (char === "[") {
      inClass = true;
    } else if (char === ".") {
      return true;
    }
  }
  return false;
}

/** Returns whether a regular-expression pattern is shaped like an identifier guard. */
function isIdentifierGuardPattern(pattern) {
  const startsLikeGuard = pattern.startsWith("^[") || pattern.startsWith("^\\w");
  if (!startsLikeGuard || !pattern.endsWith("$")) return false;
  if (!/^[\x20-\x7e]+$/.test(pattern)) return false;
  if (!/[+*{]/.test(pattern)) return false;
  if (hasCapturingGroup(pattern) || hasWildcardDot(pattern)) return false;
  return true;
}

/** Returns whether a node is a regular-expression literal shaped like an identifier guard. */
function isIdentifierGuardLiteral(node) {
  return ts.isRegularExpressionLiteral(node) && isIdentifierGuardPattern(patternOf(node.text));
}

/** Collects every identifier-guard regex literal in one file. */
function collectViolations(file) {
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  return collectHits(sourceFile, file, isIdentifierGuardLiteral);
}

/** Runs the lint, prints the report, and sets the exit code. */
function main() {
  const files = selectFiles(parseLintArgs(process.argv.slice(2)));
  const hits = files.flatMap(collectViolations);
  reportLint(LINT_NAME, hits, REMEDY, files.length);
}

main();
