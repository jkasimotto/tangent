import assert from "node:assert/strict";
import test from "node:test";
import { WORK_COMMANDS, workCommand, workCommandHelpRows, workCommandMatches, workCommandsFor } from "./public/work-commands.js";

test("Work command records are unique, complete, and own the settled shortcuts", () => {
  assert.equal(new Set(WORK_COMMANDS.map((command) => command.id)).size, WORK_COMMANDS.length);
  for (const command of WORK_COMMANDS) {
    assert.match(command.id, /^[a-z][A-Za-z]+$/);
    assert.match(command.keyDisplay, /\S/);
    assert.match(command.scope, /^(work|area|goal)$/);
    assert.match(command.label, /\S/);
    assert.match(command.help, /\S/);
    assert.ok(Object.isFrozen(command));
  }
  const settled = ["previousArea", "nextArea", "openBrain", "stopBrain", "defaults", "newGoal", "focus", "fold", "questions", "note", "complete", "commands", "keys"];
  assert.deepEqual(settled.map((id) => workCommand(id).keyDisplay), ["{", "}", "b", "s", "d", "a", "f", "z", "r", "n", "x", ":", "?"]);
});

test("matching reads the registry and rejects unintended modifiers", () => {
  /** Test helper for event. */
  const event = (key, extra = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
  assert.equal(workCommandMatches(event("s"), "stopBrain"), true);
  assert.equal(workCommandMatches(event("s", { metaKey: true }), "stopBrain"), false);
  assert.equal(workCommandMatches(event("d"), "defaults"), true);
  assert.equal(workCommandMatches(event("a"), "newGoal"), true);
  assert.equal(workCommandMatches(event("j", { metaKey: true }), "session"), true);
  assert.equal(workCommandMatches(event("j"), "session"), false);
  assert.equal(workCommandMatches(event(":", { shiftKey: true }), "commands"), true);
  assert.equal(workCommandMatches(event("?", { shiftKey: true }), "keys"), true);
  assert.equal(workCommandMatches(event("{", { shiftKey: true }), "previousArea"), true);
  assert.equal(workCommandMatches(event("}", { shiftKey: true }), "nextArea"), true);
  assert.equal(workCommandMatches(event("[", { shiftKey: true }), "previousArea"), false, "the browser reports the shifted character as the event key");
  assert.equal(workCommandMatches(event("g"), "firstLast"), false, "a sequence is handled by keyboard state, not misreported as one ARIA shortcut");
});

test("palette and help consumers receive structured records", () => {
  const palette = workCommandsFor({ palette: true });
  assert.ok(palette.some((command) => command.id === "stopBrain"));
  assert.ok(palette.some((command) => command.id === "defaults"));
  assert.deepEqual(palette.filter((command) => command.kind === "navigation").map((command) => command.id), ["previousArea", "nextArea"]);
  const help = workCommandHelpRows();
  assert.equal(help.length, WORK_COMMANDS.length);
  assert.deepEqual(Object.keys(help[0]), ["id", "keyDisplay", "ariaKeyshortcuts", "scope", "label", "help", "kind"]);
  assert.notEqual(help[0], WORK_COMMANDS[0]);
});
