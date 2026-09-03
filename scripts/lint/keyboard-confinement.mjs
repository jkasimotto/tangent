#!/usr/bin/env node
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  collectHits,
  jsxAttributeName,
  listLintFiles,
  listenerEventName,
  parseLintArgs,
  parseSourceFile,
  reportLint
} from "./lint-scope.mjs";

// Confines keyboard input to two owners. The Map has one keydown listener on the host, in the
// dispatcher, which asks the surface stack first and the canvas keys second. Element-level
// onKeyDown props belong to the kit under ui/, so a feature cannot grow its own key edge.

const DISPATCHER = "packages/agent-shell/app/map/input/keyboard-dispatch.ts";
const KIT_DIRECTORY = "packages/agent-shell/app/map/ui/";
const KEY_EVENTS = new Set(["keydown", "keyup"]);
const KEY_PROPS = new Set(["onKeyDown", "onKeyUp"]);
const KEY_HANDLER_FIELDS = new Set(["onkeydown", "onkeyup"]);
const GLOBAL_RECEIVERS = new Set(["window", "document", "globalThis", "self"]);

/** True when an expression names window or document, directly or through globalThis. */
function isGlobalReceiver(node) {
  if (ts.isIdentifier(node)) return GLOBAL_RECEIVERS.has(node.text);
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "globalThis" &&
    (node.name.text === "window" || node.name.text === "document")
  );
}

/** True for `window.onkeydown = ...` or `document.onkeyup = ...` style assignments. */
function isGlobalKeyHandlerAssignment(node) {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  if (!ts.isPropertyAccessExpression(node.left)) return false;
  return KEY_HANDLER_FIELDS.has(node.left.name.text) && isGlobalReceiver(node.left.expression);
}

/** True for addEventListener("keydown" | "keyup") on any receiver. */
function isKeyListenerCall(node) {
  const eventName = listenerEventName(node);
  return eventName !== null && KEY_EVENTS.has(eventName);
}

/** True for a JSX onKeyDown or onKeyUp prop. */
function isKeyProp(node) {
  const name = jsxAttributeName(node);
  return name !== null && KEY_PROPS.has(name);
}

/** Reports the keyboard edges a file may not own: listeners outside the dispatcher, props outside the kit. */
function collectFileHits(file) {
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  const mayListen = file.repoPath === DISPATCHER;
  const mayRenderProp = file.repoPath.startsWith(KIT_DIRECTORY);
  return collectHits(sourceFile, file, (node) => {
    if (!mayListen && (isKeyListenerCall(node) || isGlobalKeyHandlerAssignment(node))) return true;
    return !mayRenderProp && isKeyProp(node);
  });
}

/** Runs keyboard confinement over the strict scope, the staged files, or explicit paths. */
function main() {
  const files = listLintFiles(parseLintArgs(process.argv.slice(2)));
  const hits = files.flatMap(collectFileHits);
  reportLint(
    "keyboard-confinement",
    hits,
    `Route key handling through ${DISPATCHER}, or render the key through a kit component under ${KIT_DIRECTORY}.`,
    files.length
  );
}

main();
