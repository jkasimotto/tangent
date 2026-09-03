#!/usr/bin/env node
// Enforces that every `*-store.ts` in the Map is a pure reducer. A store maps
// (state, action) -> state and must never reach the network, schedule work,
// read the clock, draw randomness, or mutate an array in place. The TypeScript
// AST finds each smell so a renamed receiver or an aliased global cannot hide it.
//
// Scope is strict: packages/agent-shell/app/map/** and scripts/lint/**. There is
// no GRANDFATHERED_FILES set because the Map is written fresh and lands clean.
// Selection, parsing and the report shape come from lint-scope.mjs.
import { existsSync, readFileSync, statSync } from "node:fs";
import ts from "typescript";
import { collectReasonHits, isStrictScopeFile, listLintFiles, parseLintArgs, parseSourceFile, reportLint } from "./lint-scope.mjs";

const LINT_NAME = "reducer-purity";
const STORE_SUFFIX = "-store.ts";
const REMEDY = "Keep a *-store.ts pure: move fetches and timers into *-effects.ts, pass clock and random values in through the action, and build new arrays with spread, map, filter or toSorted.";

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

/** Returns whether a lint file is an existing production store module inside the strict scope. */
function isStoreInScope(file) {
  if (!file.repoPath.endsWith(STORE_SUFFIX) || !isStrictScopeFile(file.repoPath)) return false;
  return existsSync(file.absolutePath) && statSync(file.absolutePath).isFile();
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

/** Names the purity smell one node carries, or returns null when it carries none. */
function impurityReason(node) {
  if (ts.isCallExpression(node)) return impureCallReason(node);
  if (ts.isPropertyAccessExpression(node)) return impurePropertyReason(node);
  if (ts.isNewExpression(node)) return impureNewReason(node);
  return null;
}

/** Collects every purity violation in one store module. */
function collectViolations(file) {
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  return collectReasonHits(sourceFile, file, impurityReason);
}

/** Runs the lint over the selected store modules and reports the outcome. */
function main() {
  const files = listLintFiles(parseLintArgs(process.argv.slice(2))).filter(isStoreInScope);
  const hits = files.flatMap(collectViolations);
  reportLint(LINT_NAME, hits, REMEDY, files.length);
}

main();
