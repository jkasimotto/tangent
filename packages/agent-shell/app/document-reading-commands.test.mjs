import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  documentReadingCommands as command,
  documentReadingScrollTarget,
  isDocumentTextEntry,
  matchDocumentReadingCommand,
} from "./public/document-reading-commands.js";

/** Builds one keyboard-shaped value with no accidental modifiers. */
function key(code, overrides = {}) {
  return {
    code,
    target: null,
    defaultPrevented: false,
    isComposing: false,
    keyCode: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  };
}

test("normal reading keys match exact Vim and Vimium commands", () => {
  assert.equal(matchDocumentReadingCommand(key("KeyJ")), command.lineDown);
  assert.equal(matchDocumentReadingCommand(key("KeyK")), command.lineUp);
  assert.equal(matchDocumentReadingCommand(key("KeyD", { ctrlKey: true })), command.halfPageDown);
  assert.equal(matchDocumentReadingCommand(key("KeyU", { ctrlKey: true })), command.halfPageUp);
  assert.equal(matchDocumentReadingCommand(key("KeyG")), command.stageChord);
  assert.equal(matchDocumentReadingCommand(key("KeyG"), { pendingChord: "g" }), command.top);
  assert.equal(matchDocumentReadingCommand(key("BracketRight")), command.stageChord, "] opens a chord");
  assert.equal(matchDocumentReadingCommand(key("KeyC"), { pendingChord: "]" }), command.nextComment, "]c moves to the next comment");
  assert.equal(matchDocumentReadingCommand(key("KeyC"), { pendingChord: "[" }), command.previousComment, "[c moves to the previous comment");
  assert.equal(matchDocumentReadingCommand(key("KeyN")), null, "n is reserved for search (design agent-shell-keymap 5.2)");
  assert.equal(matchDocumentReadingCommand(key("KeyG", { shiftKey: true })), command.bottom);
  assert.equal(matchDocumentReadingCommand(key("BracketLeft", { shiftKey: true })), command.previousHeading);
  assert.equal(matchDocumentReadingCommand(key("BracketRight", { shiftKey: true })), command.nextHeading);
  assert.equal(matchDocumentReadingCommand(key("KeyH", { shiftKey: true })), command.historyBack);
  assert.equal(matchDocumentReadingCommand(key("KeyL", { shiftKey: true })), command.historyForward);
  assert.equal(matchDocumentReadingCommand(key("BracketLeft")), command.stageChord);
  assert.equal(matchDocumentReadingCommand(key("KeyC"), { pendingChord: "]" }), command.nextComment);
  assert.equal(matchDocumentReadingCommand(key("KeyC"), { pendingChord: "[" }), command.previousComment);
  assert.equal(matchDocumentReadingCommand(key("KeyC")), command.createComment);
  assert.equal(matchDocumentReadingCommand(key("KeyE"), { activeComment: true }), command.editComment);
  assert.equal(matchDocumentReadingCommand(key("KeyR"), { activeComment: true }), command.replyComment);
  assert.equal(matchDocumentReadingCommand(key("KeyX"), { activeComment: true }), command.resolveComment);
  assert.equal(matchDocumentReadingCommand(key("Slash", { shiftKey: true })), command.help);
});

test("Escape is staged and read-only readers keep navigation without comment creation", () => {
  assert.equal(matchDocumentReadingCommand(key("Escape")), command.closeReader);
  assert.equal(matchDocumentReadingCommand(key("Escape"), { hasSelection: true, activeComment: true }), command.clearSelection);
  assert.equal(matchDocumentReadingCommand(key("Escape"), { activeComment: true }), command.clearComment);
  assert.equal(matchDocumentReadingCommand(key("KeyC"), { commentCreation: false }), null);
  assert.equal(matchDocumentReadingCommand(key("KeyC"), { commentCreation: false, pendingChord: "]" }), command.nextComment);
  assert.equal(matchDocumentReadingCommand(key("KeyC"), { commentCreation: false, pendingChord: "[" }), command.previousComment);
  assert.equal(matchDocumentReadingCommand(key("KeyC"), { commentNavigation: false, pendingChord: "]" }), null);
  assert.equal(matchDocumentReadingCommand(key("KeyE")), null, "comment actions need an active comment");
  assert.equal(matchDocumentReadingCommand(key("KeyR"), { activeComment: true, commentLifecycle: false }), null, "read-only readers do not mutate comments");
  assert.equal(matchDocumentReadingCommand(key("KeyX"), { activeComment: true, commentLifecycle: false }), null);
});

test("r resumes the Goal attempt only while no comment is active and a Resume verb is shown", () => {
  assert.equal(matchDocumentReadingCommand(key("KeyR"), { resumableAttempt: true }), command.resumeAttempt);
  assert.equal(matchDocumentReadingCommand(key("KeyR"), { resumableAttempt: true, activeComment: true }), command.replyComment, "an active comment keeps r for its reply");
  assert.equal(matchDocumentReadingCommand(key("KeyR")), null, "no Resume verb, no command");
  assert.equal(matchDocumentReadingCommand(key("KeyR", { shiftKey: true }), { resumableAttempt: true }), null);
});

test("wrong modifiers, IME input, and an earlier owner never reach reading mode", () => {
  assert.equal(matchDocumentReadingCommand(key("KeyJ", { shiftKey: true })), null);
  assert.equal(matchDocumentReadingCommand(key("KeyJ", { ctrlKey: true })), null);
  assert.equal(matchDocumentReadingCommand(key("KeyD")), null);
  assert.equal(matchDocumentReadingCommand(key("KeyD", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(matchDocumentReadingCommand(key("KeyG", { shiftKey: true, metaKey: true })), null);
  assert.equal(matchDocumentReadingCommand(key("KeyH")), null);
  assert.equal(matchDocumentReadingCommand(key("BracketLeft")), command.stageChord, "[ opens the [c chord");
  assert.equal(matchDocumentReadingCommand(key("Slash")), null);
  assert.equal(matchDocumentReadingCommand(key("KeyC", { metaKey: true })), null);
  assert.equal(matchDocumentReadingCommand(key("KeyE", { shiftKey: true }), { activeComment: true }), null);
  assert.equal(matchDocumentReadingCommand(key("KeyJ", { isComposing: true })), null);
  assert.equal(matchDocumentReadingCommand(key("KeyJ", { keyCode: 229 })), null);
  for (const keyValue of ["Dead", "Process", "Unidentified"]) {
    assert.equal(matchDocumentReadingCommand(key("KeyJ", { key: keyValue })), null, keyValue);
  }
  assert.equal(matchDocumentReadingCommand(key("KeyJ", { defaultPrevented: true })), null);
});

test("text controls and editable descendants own every reading key", () => {
  const dom = new JSDOM(`<main><input id="input"><textarea id="textarea"></textarea><select id="select"></select><div id="editable" contenteditable="true"><span id="child">text</span></div><div id="textbox" role="textbox"></div><button id="button">Button</button></main>`);
  for (const id of ["input", "textarea", "select", "editable", "child", "textbox"]) {
    const target = dom.window.document.getElementById(id);
    assert.equal(isDocumentTextEntry(target), true, id);
    assert.equal(matchDocumentReadingCommand(key("KeyJ", { target })), null, id);
  }
  assert.equal(isDocumentTextEntry(dom.window.document.getElementById("button")), false);
});

test("scroll targets clamp lines and half pages and select adjacent headings", () => {
  const metrics = { scrollTop: 300, clientHeight: 600, scrollHeight: 1500, lineStep: 45, headingOffsets: [0, 120, 301, 780, 1490] };
  assert.equal(documentReadingScrollTarget(command.lineDown, metrics), 345);
  assert.equal(documentReadingScrollTarget(command.lineUp, metrics), 255);
  assert.equal(documentReadingScrollTarget(command.halfPageDown, metrics), 600);
  assert.equal(documentReadingScrollTarget(command.halfPageUp, metrics), 0);
  assert.equal(documentReadingScrollTarget(command.top, metrics), 0);
  assert.equal(documentReadingScrollTarget(command.bottom, metrics), 900);
  assert.equal(documentReadingScrollTarget(command.nextHeading, metrics), 780);
  assert.equal(documentReadingScrollTarget(command.previousHeading, metrics), 120);
  assert.equal(documentReadingScrollTarget(command.help, metrics), null);
  assert.equal(documentReadingScrollTarget(command.nextHeading, { ...metrics, scrollTop: 900 }), null);
});
