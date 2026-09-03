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
// Scope is packages/agent-shell/app/** production sources. The Map and the lint
// kit are strict; the rest of the app ratchets down through GRANDFATHERED_FILES.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const LINT_NAME = "wire-guard-confinement";
const WIDE_SCOPE_DIR = "packages/agent-shell/app";
const REGISTRY_FILE = "packages/agent-shell/app/public/area-map-wire-values.js";
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx"]);
const SKIPPED_DIR_NAMES = new Set(["node_modules", "dist", "test-fixtures"]);

/** Files that failed when the lint was introduced. This set burns down to empty; never add to it. */
const GRANDFATHERED_FILES = new Set([
  "packages/agent-shell/app/action-telemetry.mjs",
  "packages/agent-shell/app/area-map-world-index.mjs",
  "packages/agent-shell/app/area-map-world-view-store.mjs",
  "packages/agent-shell/app/area-resource-catalog.mjs",
  "packages/agent-shell/app/area-resource-mutations.mjs",
  "packages/agent-shell/app/area-resource-observations.mjs",
  "packages/agent-shell/app/goal-cards.mjs",
  "packages/agent-shell/app/map-kinds.mjs",
  "packages/agent-shell/app/process-note.mjs",
  "packages/agent-shell/app/programs.mjs",
  "packages/agent-shell/app/public/action-telemetry.js",
  "packages/agent-shell/app/public/area-map-entities.js",
  "packages/agent-shell/app/public/area-map-world-controller.js",
  "packages/agent-shell/app/server.mjs",
  "packages/agent-shell/app/session-ownership.mjs"
]);

/** Parses the command line into staged flag, root directory and explicit paths. */
function parseArgs(argv) {
  const parsed = { staged: false, root: process.cwd(), paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--staged") {
      parsed.staged = true;
    } else if (arg === "--root") {
      parsed.root = path.resolve(argv[index + 1] ?? ".");
      index += 1;
    } else {
      parsed.paths.push(arg);
    }
  }
  return parsed;
}

/** Converts an absolute path to the forward-slash repo-relative form used in reports. */
function toRepoPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

/** Returns whether a repo-relative path is a production source inside the wide scope. */
function isProductionSourceInScope(repoPath) {
  if (!repoPath.startsWith(`${WIDE_SCOPE_DIR}/`)) return false;
  const segments = repoPath.split("/");
  if (segments.some((segment) => SKIPPED_DIR_NAMES.has(segment))) return false;
  const base = path.basename(repoPath);
  if (base.includes(".test.") || base.endsWith(".d.ts")) return false;
  return SOURCE_EXTENSIONS.has(path.extname(base));
}

/** Recursively lists every file under a directory, skipping build and dependency folders. */
function walkFiles(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIR_NAMES.has(entry.name)) result.push(...walkFiles(fullPath));
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

/** Lists every scoped production source for a full run. */
function listScopedFiles(root) {
  const full = path.join(root, WIDE_SCOPE_DIR);
  if (!existsSync(full)) return [];
  return walkFiles(full).filter((file) => isProductionSourceInScope(toRepoPath(root, file)));
}

/** Lists staged files that are scoped production sources. */
function listStagedFiles(root) {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { cwd: root, encoding: "utf8" });
  return output
    .split("\0")
    .filter(Boolean)
    .filter(isProductionSourceInScope)
    .map((repoPath) => path.join(root, repoPath))
    .filter((file) => existsSync(file) && statSync(file).isFile());
}

/** Resolves explicit paths against the root and keeps the scoped production sources among them. */
function listExplicitFiles(root, paths) {
  return paths
    .map((given) => (path.isAbsolute(given) ? given : path.join(root, given)))
    .filter((file) => isProductionSourceInScope(toRepoPath(root, file)))
    .filter((file) => existsSync(file) && statSync(file).isFile());
}

/** Maps a source path to the TypeScript parser script kind. */
function scriptKindFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".tsx" || ext === ".jsx") return ts.ScriptKind.TSX;
  if (ext === ".ts") return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
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

/** Collects every identifier-guard regex literal in one file as report lines. */
function collectViolations(root, file) {
  const repoPath = toRepoPath(root, file);
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const lines = source.split("\n");
  const hits = [];

  /** Visits one node, records an id-shaped regex literal, and descends into its children. */
  function visit(node) {
    if (ts.isRegularExpressionLiteral(node) && isIdentifierGuardPattern(patternOf(node.text))) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      hits.push(`${repoPath}:${line}  ${(lines[line - 1] ?? "").trim()}`);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return hits;
}

/** Returns whether a scoped file is exempt: the registry itself or a grandfathered file. */
function isExempt(root, file) {
  const repoPath = toRepoPath(root, file);
  return repoPath === REGISTRY_FILE || GRANDFATHERED_FILES.has(repoPath);
}

/** Chooses the file list for this run from the parsed arguments. */
function selectFiles(parsed) {
  if (parsed.paths.length > 0) return listExplicitFiles(parsed.root, parsed.paths);
  if (parsed.staged) return listStagedFiles(parsed.root);
  return listScopedFiles(parsed.root);
}

/** Runs the lint, prints the report, and sets the exit code. */
function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const files = selectFiles(parsed).filter((file) => !isExempt(parsed.root, file));
  const hits = files.flatMap((file) => collectViolations(parsed.root, file));

  if (hits.length > 0) {
    for (const hit of hits) console.error(hit);
    console.error(`${LINT_NAME} lint failed with ${hits.length} violation(s) in ${files.length} file(s).`);
    console.error(`Register the guard beside its minter in ${REGISTRY_FILE} and import it from there.`);
    process.exitCode = 1;
    return;
  }
  console.log(`${LINT_NAME} lint passed (${files.length} file(s) checked).`);
}

main();
