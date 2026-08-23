import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Loads the terminal key module into a window of its own. */
async function loadTerminalKeys() {
  const source = await readFile(path.join(here, "public", "terminal-keys.js"), "utf8");
  const { window } = new JSDOM("", { runScripts: "outside-only" });
  window.eval(source);
  return window.AgentShellTerminalKeys;
}

/** Builds a keyboard event as xterm gives it to the key handler. */
function keyEvent(fields) {
  return { type: "keydown", key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...fields };
}

test("Shift+Enter sends Meta+Enter, and every other Enter stays with xterm", async () => {
  const keys = await loadTerminalKeys();

  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true })), "\x1b\r");

  assert.equal(keys.terminalKeySequence(keyEvent({})), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, metaKey: true })), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, altKey: true })), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, ctrlKey: true })), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, type: "keyup" })), "");
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, key: "a" })), "");
});
