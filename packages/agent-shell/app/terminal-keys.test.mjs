import assert from "node:assert/strict";
import test from "node:test";
import keys from "./public/terminal-keys.js";

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
  assert.equal(keys.terminalKeySequence(keyEvent({ shiftKey: true, isComposing: true })), "");
});
