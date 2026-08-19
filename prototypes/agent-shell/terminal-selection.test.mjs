import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Creates a focused xterm double for selection lifecycle tests. */
function terminalDouble() {
  let selection = "";
  let position;
  let selectionHandler;
  const terminal = {
    cols: 80,
    /** Gives the text xterm reports as selected. */
    getSelection: () => selection,
    /** Gives the buffer range xterm reports as selected. */
    getSelectionPosition: () => position,
    /** Says whether xterm holds a selection. */
    hasSelection: () => Boolean(selection),
    /** Keeps the selection listener the module registers. */
    onSelectionChange(handler) {
      selectionHandler = handler;
      return {
        /** Ends the subscription. */
        dispose() {},
      };
    },
    /** Repaints the highlight the module asks for. */
    select(column, row, length) {
      terminal.restored = { column, row, length };
      selection = "repainted cells";
      position = { start: { x: column, y: row }, end: { x: column + length, y: row } };
      selectionHandler();
    },
    /** Drops the highlight, as a repaint does. */
    clearSelection() {
      selection = "";
      position = undefined;
      selectionHandler();
    },
    /** Puts a finished selection in place. */
    setSelection(text, range) {
      selection = text;
      position = range;
      selectionHandler();
    },
  };
  return terminal;
}

test("completed terminal selections survive repaints and Command-C copies the original text", async () => {
  const source = await readFile(path.join(here, "public", "terminal-selection.js"), "utf8");
  const dom = new JSDOM("<div id='host'></div>", { runScripts: "outside-only" });
  const { window } = dom;
  const terminal = terminalDouble();
  const copied = [];
  const deferred = [];
  window.eval(source);
  const selection = window.AgentShellTerminalSelection.preserveTerminalSelection({
    terminal,
    host: window.document.querySelector("#host"),
    clipboard: {
      /** Records what the module copies. */
      async writeText(text) { copied.push(text); },
    },
    /** Holds the deferred restore until the test runs it. */
    defer(callback) { deferred.push(callback); },
  });

  let forcedSelectionGesture = false;
  window.document.querySelector("#host").addEventListener("mousedown", (event) => {
    forcedSelectionGesture = event.altKey;
  });
  window.document.querySelector("#host").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
  assert.equal(forcedSelectionGesture, true);
  window.document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, button: 0 }));

  const range = { start: { x: 4, y: 2 }, end: { x: 9, y: 3 } };
  terminal.setSelection("exact\nselected text", range);
  terminal.clearSelection();
  assert.equal(deferred.length, 1);
  deferred.shift()();
  assert.deepEqual(terminal.restored, { column: 4, row: 2, length: 85 });

  let prevented = false;
  const forwarded = selection.handleKeyEvent({
    type: "keydown",
    metaKey: true,
    key: "c",
    /** Records that the module took the key. */
    preventDefault() { prevented = true; },
  });
  await Promise.resolve();
  assert.equal(forwarded, false);
  assert.equal(prevented, true);
  assert.deepEqual(copied, ["exact\nselected text"]);
});
