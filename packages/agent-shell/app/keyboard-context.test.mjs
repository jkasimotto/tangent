import test from "node:test";
import assert from "node:assert/strict";
import { keyboardEventIsComposing, resolveKeyboardContext } from "./public/keyboard-context.js";

test("keyboard context follows visible layer priority", () => {
  assert.equal(resolveKeyboardContext({ view: "work" }), "work");
  assert.equal(resolveKeyboardContext({ view: "work", textEntry: true }), "text-entry");
  assert.equal(resolveKeyboardContext({ view: "work", textEntry: true, transient: true }), "transient");
  assert.equal(resolveKeyboardContext({ view: "work", transient: true, focusPicker: true }), "transient");
  assert.equal(resolveKeyboardContext({ view: "work", focusPicker: true }), "focus-picker");
  assert.equal(resolveKeyboardContext({ view: "work", focusPicker: true, session: true }), "session");
  assert.equal(resolveKeyboardContext({ session: true, documentPeek: true }), "document-peek");
  assert.equal(resolveKeyboardContext({ documentPeek: true, goTo: true }), "go-to");
});

test("a blocking modal owns every overlap, including Go To", () => {
  assert.equal(resolveKeyboardContext({
    modal: true,
    goTo: true,
    documentPeek: true,
    session: true,
    focusPicker: true,
    transient: true,
    textEntry: true,
    view: "work",
  }), "modal");
});

test("IME and unfinished keyboard composition values never become shortcuts", () => {
  assert.equal(keyboardEventIsComposing({ key: "k", isComposing: true }), true);
  for (const key of ["Dead", "Process", "Unidentified"]) {
    assert.equal(keyboardEventIsComposing({ key }), true, key);
  }
  assert.equal(keyboardEventIsComposing({ key: "k", isComposing: false }), false);
});
