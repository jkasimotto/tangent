#!/usr/bin/env node
// Enforces that every `*-store.ts` in the Map is a pure reducer. A store maps
// (state, action) -> state and must never reach the network, schedule work,
// read the clock, draw randomness, or mutate an array in place. The TypeScript
// AST finds each smell so a renamed receiver or an aliased global cannot hide it.
//
// Scope is strict: packages/agent-shell/app/map/** and scripts/lint/**. There is
// no GRANDFATHERED_FILES set because the Map is written fresh and lands clean.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const LINT_NAME = "reducer-purity";
const STRICT_SCOPE_DIRS = ["packages/agent-shell/app/map", "scripts/lint"];
const SKIPPED_DIR_NAMES = new Set(["node_modules", "dist", "test-fixtures"]);

/** Globals that perform I/O or schedule work; banned as a bare call or via window, globalThis or self. */
const BANNED_GLOBAL_CALLS = new Set(["fetch", "setTimeout", "setInterval", "requestAnimationFrame"]);

/** Property reads that make a reducer nondeterministic, keyed by receiver identifier. */
const BANNED_PROPERTY_READS = new Map([
  ["Date", new Set(["now"])],
  ["Math", new Set(["random"])],
  ["performance", new Set(["now"])]
]);

/** Array methods that mutate their receiver in place. */
const MUTATING_ARRAY_METHODS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);

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

/** Returns whether a repo-relative path is a production store module inside the strict scope. */
function isStoreInScope(repoPath) {
  if (!repoPath.endsWith("-store.ts")) return false;
  const segments = repoPath.split("/");
  if (segments.some((segment) => SKIPPED_DIR_NAMES.has(segment))) return false;
  return STRICT_SCOPE_DIRS.some((dir) => repoPath.startsWith(`${dir}/`));
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

/** Lists every scoped store module for a full run. */
function listScopedFiles(root) {
  const result = [];
  for (const dir of STRICT_SCOPE_DIRS) {
    const full = path.join(root, dir);
    if (!existsSync(full)) continue;
    for (const file of walkFiles(full)) {
      if (isStoreInScope(toRepoPath(root, file))) result.push(file);
    }
  }
  return result;
}

/** Lists staged files that are scoped store modules. */
function listStagedFiles(root) {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { cwd: root, encoding: "utf8" });
  return output
    .split("\0")
    .filter(Boolean)
    .filter(isStoreInScope)
    .map((repoPath) => path.join(root, repoPath))
    .filter((file) => existsSync(file) && statSync(file).isFile());
}

/** Resolves explicit paths against the root and keeps the scoped store modules among them. */
function listExplicitFiles(root, paths) {
  return paths
    .map((given) => (path.isAbsolute(given) ? given : path.join(root, given)))
    .filter((file) => isStoreInScope(toRepoPath(root, file)))
    .filter((file) => existsSync(file) && statSync(file).isFile());
}

/** Returns the identifier text of a receiver expression, or null when the receiver is not a plain identifier. */
function receiverName(expression) {
  return ts.isIdentifier(expression) ? expression.text : null;
}

/** Names the reason a call expression is impure, or returns null when it is allowed. */
function impureCallReason(node) {
  const callee = node.expression;
  if (ts.isIdentifier(callee) && BANNED_GLOBAL_CALLS.has(callee.text)) {
    return `${callee.text}() reaches outside the reducer`;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const property = callee.name.text;
    const receiver = receiverName(callee.expression);
    const isGlobalReceiver = receiver === "window" || receiver === "globalThis" || receiver === "self";
    if (isGlobalReceiver && BANNED_GLOBAL_CALLS.has(property)) {
      return `${receiver}.${property}() reaches outside the reducer`;
    }
    if (MUTATING_ARRAY_METHODS.has(property)) {
      return `.${property}() mutates its receiver in place`;
    }
  }
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression)) {
    const property = callee.argumentExpression.text;
    if (MUTATING_ARRAY_METHODS.has(property)) {
      return `["${property}"]() mutates its receiver in place`;
    }
  }
  return null;
}

/** Names the reason a property access is nondeterministic, or returns null when it is allowed. */
function impurePropertyReason(node) {
  const receiver = receiverName(node.expression);
  const banned = receiver === null ? undefined : BANNED_PROPERTY_READS.get(receiver);
  if (banned && banned.has(node.name.text)) {
    return `${receiver}.${node.name.text} reads the clock or randomness`;
  }
  return null;
}

/** Names the reason a `new` expression is impure, or returns null when it is allowed. */
function impureNewReason(node) {
  if (ts.isIdentifier(node.expression) && node.expression.text === "Date") {
    return "new Date() reads the clock";
  }
  return null;
}

/** Collects every purity violation in one store module as report lines. */
function collectViolations(root, file) {
  const repoPath = toRepoPath(root, file);
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits = [];

  /** Records one violation with its 1-based line and reason. */
  function record(node, reason) {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    hits.push(`${repoPath}:${line}  ${reason}`);
  }

  /** Visits one node, records any smell it carries, and descends into its children. */
  function visit(node) {
    let reason = null;
    if (ts.isCallExpression(node)) reason = impureCallReason(node);
    else if (ts.isPropertyAccessExpression(node)) reason = impurePropertyReason(node);
    else if (ts.isNewExpression(node)) reason = impureNewReason(node);
    if (reason) record(node, reason);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return hits;
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
  const files = selectFiles(parsed);
  const hits = files.flatMap((file) => collectViolations(parsed.root, file));

  if (hits.length > 0) {
    for (const hit of hits) console.error(hit);
    console.error(`${LINT_NAME} lint failed with ${hits.length} violation(s) in ${files.length} store module(s).`);
    console.error("Keep a *-store.ts pure: move fetches and timers into *-effects.ts, pass clock and random values in through the action, and build new arrays with spread, map, filter or toSorted.");
    process.exitCode = 1;
    return;
  }
  console.log(`${LINT_NAME} lint passed (${files.length} store module(s) checked).`);
}

main();
