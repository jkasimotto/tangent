#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  collectHits,
  jsxAttributeName,
  listLintFiles,
  listenerEventName,
  parseLintArgs,
  parseSourceFile,
  reportLint
} from "./lint-scope.mjs";

// Confines pointer input to one owner. Excalidraw's pointer props are wired only in MapCanvas.tsx,
// which forwards to the pointer session, and no file in scope installs its own pointer or mouse
// listener. One pure function decides what a press means, so a second pointer edge is a bug.

const CANVAS_HOST = "packages/agent-shell/app/map/canvas/MapCanvas.tsx";
const EXCALIDRAW_POINTER_PROPS = new Set(["onPointerDown", "onPointerUp", "onPointerUpdate"]);
const BANNED_LISTENER_EVENTS = new Set(["pointerdown", "pointermove", "pointerup", "mousedown", "mousemove", "mouseup"]);

/** True for a JSX onPointerDown, onPointerUp or onPointerUpdate prop. */
function isExcalidrawPointerProp(node) {
  const name = jsxAttributeName(node);
  return name !== null && EXCALIDRAW_POINTER_PROPS.has(name);
}

/** True for addEventListener with a pointer or mouse event name on any receiver. */
function isPointerListenerCall(node) {
  const eventName = listenerEventName(node);
  return eventName !== null && BANNED_LISTENER_EVENTS.has(eventName);
}

/** Reports pointer props outside the canvas host and pointer listeners anywhere. */
function collectFileHits(file) {
  const sourceFile = parseSourceFile(file, readFileSync(file.absolutePath, "utf8"));
  const mayWireProps = file.repoPath === CANVAS_HOST;
  return collectHits(sourceFile, file, (node) => {
    if (isPointerListenerCall(node)) return true;
    return !mayWireProps && isExcalidrawPointerProp(node);
  });
}

/** Runs pointer confinement over the strict scope, the staged files, or explicit paths. */
function main() {
  const files = listLintFiles(parseLintArgs(process.argv.slice(2)));
  const hits = files.flatMap(collectFileHits);
  reportLint(
    "pointer-confinement",
    hits,
    `Wire Excalidraw's pointer props only in ${CANVAS_HOST} and let the pointer session handle the press; do not add pointer or mouse listeners.`,
    files.length
  );
}

main();
