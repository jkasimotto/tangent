import assert from "node:assert/strict";
import test from "node:test";
import { WORK_COMMANDS, workCommand, workCommandHelpRows, workCommandMatches, workCommandsFor } from "./public/work-commands.js";

test("Work command records are unique, complete, and own the settled shortcuts", () => {
  assert.equal(new Set(WORK_COMMANDS.map((command) => command.id)).size, WORK_COMMANDS.length);
  for (const command of WORK_COMMANDS) {
    assert.match(command.id, /^[a-z][A-Za-z]+$/);
    if (!["note", "chooseAreas"].includes(command.id)) assert.match(command.keyDisplay, /\S/);
    assert.match(command.scope, /^(work|area|goal|document)$/);
    assert.match(command.label, /\S/);
    assert.match(command.help, /\S/);
    assert.ok(Object.isFrozen(command));
  }
  const settled = ["previousArea", "nextArea", "stopAgent", "defaults", "messageBrain", "starArea", "starredOnly", "activeOnly", "collapse", "expand", "questions", "readGoal", "goalStatus", "search", "nextMatch", "previousMatch", "keys"];
  assert.deepEqual(settled.map((id) => workCommand(id).keyDisplay), ["{", "}", "s", "d", "a", "f", "F", "A", "h", "l", "r", "o", "x", "/", "n", "N", "?"]);
  assert.equal(workCommand("openBrain"), null, "the separate brain command and b shortcut are retired");
  assert.equal(workCommand("note").keyDisplay, "", "Capture note has no key (Julian, 2026-08-28); it stays in the ? sheet");
  assert.equal(workCommand("commands"), null, "commands and keys are one list under ? (Julian, 2026-08-28)");
  assert.equal(workCommand("filter"), null, "the Work filter is gone; / searches");
  assert.equal(workCommand("fold"), null, "z and the toggle command have left Work");
});

test("matching reads the registry and rejects unintended modifiers", () => {
  /** Test helper for event. */
  const event = (key, extra = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
  assert.equal(workCommandMatches(event("s"), "stopAgent"), true);
  assert.equal(workCommandMatches(event("s", { metaKey: true }), "stopAgent"), false);
  assert.equal(workCommandMatches(event("d"), "defaults"), true);
  assert.equal(workCommandMatches(event("a"), "messageBrain"), true);
  assert.equal(workCommandMatches(event("h"), "collapse"), true);
  assert.equal(workCommandMatches(event("l"), "expand"), true);
  assert.equal(workCommandMatches(event("z"), "collapse"), false);
  assert.equal(workCommandMatches(event("o"), "readGoal"), true);
  assert.equal(workCommandMatches(event("x"), "goalStatus"), true);
  assert.equal(workCommandMatches(event("Enter", { metaKey: true, shiftKey: true }), "session"), true);
  assert.equal(workCommandMatches(event("Enter", { metaKey: true }), "session"), false, "Command-Enter alone submits forms");
  assert.equal(workCommandMatches(event("Enter", { shiftKey: true }), "session"), false);
  assert.equal(WORK_COMMANDS.some((command) => workCommandMatches(event("b"), command.id)), false, "b triggers no Work command");
  assert.equal(workCommandMatches(event("?", { shiftKey: true }), "keys"), true);
  assert.equal(workCommandMatches(event("A", { shiftKey: true }), "activeOnly"), true);
  assert.equal(workCommandMatches(event("A", { shiftKey: true }), "messageBrain"), false, "Shift+A never messages the brain");
  assert.equal(workCommandMatches(event("{", { shiftKey: true }), "previousArea"), true);
  assert.equal(workCommandMatches(event("}", { shiftKey: true }), "nextArea"), true);
  assert.equal(workCommandMatches(event("[", { shiftKey: true }), "previousArea"), false, "the browser reports the shifted character as the event key");
  assert.equal(workCommandMatches(event("g"), "firstLast"), false, "a sequence is handled by keyboard state, not misreported as one ARIA shortcut");
});

test("sheet and help consumers receive structured records", () => {
  const sheet = workCommandsFor();
  assert.equal(sheet.length, WORK_COMMANDS.length, "the ? sheet lists every command");
  assert.deepEqual(workCommandsFor({ scope: "goal" }).map((command) => command.id), ["readGoal", "resumeAttempt", "changeAgent", "goalStatus"]);
  assert.equal(workCommand("stopAgent").scope, "work", "the same stop command applies to selected Areas and Goals");
  const help = workCommandHelpRows();
  assert.equal(help.length, WORK_COMMANDS.length);
  assert.deepEqual(Object.keys(help[0]), ["id", "keyDisplay", "ariaKeyshortcuts", "scope", "label", "help", "kind"]);
  assert.notEqual(help[0], WORK_COMMANDS[0]);
});
