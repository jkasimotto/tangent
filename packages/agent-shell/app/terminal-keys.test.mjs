import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import keys from "./public/terminal-keys.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Builds a keyboard event as xterm gives it to the key handler. */
function keyEvent(fields) {
  return { type: "keydown", key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...fields };
}

test("Shift+Enter sends Meta+Enter, and every other Enter stays with xterm", () => {

  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true })), "\x1b\r");

  assert.equal(keys.terminalKeySequence(keyEvent({})), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, metaKey: true })), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, altKey: true })), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, ctrlKey: true })), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, type: "keyup" })), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, key: "a" })), "");
});

test("the terminal fits before it opens the tmux transport", async () => {
  const source = await readFile(path.join(here, "public", "terminal-controller.js"), "utf8");
  const deferred = source.slice(source.indexOf("window.setTimeout(() =>"), source.indexOf("terminal.onData"));
  assert.ok(deferred.indexOf("fit();") < deferred.indexOf("connect();"), "layout fit happens before WebSocket creation");
  assert.match(source, /fit:\s*\(\)\s*=>\s*fitTerminal\?\.\(\)/, "browser resize reports dimensions to the PTY");
});
