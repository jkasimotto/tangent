import assert from "node:assert/strict";
import test from "node:test";
import { CHORD_WINDOW_MS, createChordEngine, motions, resolveMotion } from "./public/motion-keys.js";

/** Test helper for a keydown event fact. */
const event = (key, extra = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

test("letters and arrows are synonyms when no text field owns the keyboard", () => {
  assert.equal(resolveMotion(event("j")), motions.next);
  assert.equal(resolveMotion(event("ArrowDown")), motions.next);
  assert.equal(resolveMotion(event("k")), motions.previous);
  assert.equal(resolveMotion(event("ArrowUp")), motions.previous);
  assert.equal(resolveMotion(event("G", { shiftKey: true })), motions.last);
  assert.equal(resolveMotion(event("End")), motions.last);
  assert.equal(resolveMotion(event("Home")), motions.first);
  assert.equal(resolveMotion(event("}", { shiftKey: true })), motions.sectionNext);
  assert.equal(resolveMotion(event("{", { shiftKey: true })), motions.sectionPrevious);
  assert.equal(resolveMotion(event("l")), motions.child);
  assert.equal(resolveMotion(event("ArrowRight")), motions.child);
  assert.equal(resolveMotion(event("h")), motions.parent);
  assert.equal(resolveMotion(event("ArrowLeft")), motions.parent);
  assert.equal(resolveMotion(event("d", { ctrlKey: true })), motions.halfDown);
  assert.equal(resolveMotion(event("PageDown")), motions.halfDown);
  assert.equal(resolveMotion(event("u", { ctrlKey: true })), motions.halfUp);
  assert.equal(resolveMotion(event("PageUp")), motions.halfUp);
});

test("chords: g stages, gg is first; ]c and [c move by comment", () => {
  assert.equal(resolveMotion(event("g")), motions.chordStart);
  assert.equal(resolveMotion(event("g"), { pendingChord: "g" }), motions.first);
  assert.equal(resolveMotion(event("]")), motions.chordStart);
  assert.equal(resolveMotion(event("c"), { pendingChord: "]" }), motions.commentNext);
  assert.equal(resolveMotion(event("c"), { pendingChord: "[" }), motions.commentPrevious);
  assert.equal(resolveMotion(event("c")), null, "a bare c is an action letter, not a motion");
  assert.equal(resolveMotion(event("x"), { pendingChord: "g" }), null, "a wrong second key resolves nothing");
});

test("inside a text field only arrows and Ctrl-N / Ctrl-P move", () => {
  assert.equal(resolveMotion(event("j"), { textOwned: true }), null);
  assert.equal(resolveMotion(event("g"), { textOwned: true }), null);
  assert.equal(resolveMotion(event("ArrowDown"), { textOwned: true }), motions.next);
  assert.equal(resolveMotion(event("n", { ctrlKey: true }), { textOwned: true }), motions.next);
  assert.equal(resolveMotion(event("p", { ctrlKey: true }), { textOwned: true }), motions.previous);
  assert.equal(resolveMotion(event("d", { ctrlKey: true }), { textOwned: true }), null, "Ctrl-D stays with the field");
  assert.equal(resolveMotion(event("Home"), { textOwned: true }), null, "Home moves the caret, not the list");
});

test("Command and Option keys never resolve to a motion", () => {
  assert.equal(resolveMotion(event("j", { metaKey: true })), null);
  assert.equal(resolveMotion(event("k", { altKey: true })), null);
  assert.equal(resolveMotion(event("ArrowDown", { metaKey: true })), null);
});

test("the chord engine stages one key per surface and forgets it after the window", () => {
  const timers = [];
  const engine = createChordEngine((fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {});
  engine.stage("work", "g");
  assert.equal(engine.pendingFor("work"), "g");
  assert.equal(engine.pendingFor("reader:full"), "", "another surface sees nothing");
  assert.equal(timers.at(-1).ms, CHORD_WINDOW_MS);
  engine.clear("reader:full");
  assert.equal(engine.pendingFor("work"), "g", "a clear for another surface leaves the stage alone");
  timers.at(-1).fn();
  assert.equal(engine.pendingFor("work"), "", "the window closed");
  engine.stage("work", "]");
  engine.clear();
  assert.equal(engine.pendingFor("work"), "");
});
