import assert from "node:assert/strict";
import test from "node:test";

import { deriveDisplayTitle, extractCommandName, isCommandXml, isTaskNotificationXml, stripCommandMarkup, taskNotificationLabel } from "../dist/index.js";

const COMMAND_TITLE = "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>";
const TASK_NOTIFICATION = "<task-notification>\n<task-id>ab57f5fd</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<output-file>/tmp/x.output</output-file>\n<status>completed</status>\n<summary>Agent finished mapping the repo</summary>";

test("detects and strips command XML", () => {
  assert.equal(isCommandXml(COMMAND_TITLE), true);
  assert.equal(isCommandXml("Fix the login bug"), false);
  assert.equal(extractCommandName(COMMAND_TITLE), "/model");
  assert.equal(stripCommandMarkup(`before ${COMMAND_TITLE} after`), "before after");
  assert.equal(stripCommandMarkup("<local-command-stdout>Cleared context</local-command-stdout> kept"), "kept");
});

test("deriveDisplayTitle prefers the first non-command candidate when the title is command XML", () => {
  assert.equal(deriveDisplayTitle([COMMAND_TITLE, "Fix the login bug"]), "Fix the login bug");
});

test("deriveDisplayTitle falls back to a bare '<command> session' label when every candidate is command XML", () => {
  assert.equal(deriveDisplayTitle([COMMAND_TITLE]), "/model session");
  assert.equal(deriveDisplayTitle([COMMAND_TITLE, undefined, ""]), "/model session");
});

test("deriveDisplayTitle passes ordinary titles through and applies the fallback when all candidates are empty", () => {
  assert.equal(deriveDisplayTitle(["Fix the login bug", COMMAND_TITLE]), "Fix the login bug");
  assert.equal(deriveDisplayTitle([undefined, ""], "session-id"), "session-id");
});

test("labels task notifications by their summary, tolerating truncated previews", () => {
  assert.equal(isTaskNotificationXml(TASK_NOTIFICATION), true);
  assert.equal(isTaskNotificationXml("plain text mentioning <task-notification> later"), false);
  assert.equal(taskNotificationLabel(TASK_NOTIFICATION), "Agent finished mapping the repo");
  assert.equal(taskNotificationLabel("<task-notification>\n<task-id>x</task-id>\n<status>completed</status>"), "Task completed");
  assert.equal(taskNotificationLabel("<task-notification>\n<task-id>x</task-id>"), "Task notification");
  assert.equal(deriveDisplayTitle([TASK_NOTIFICATION]), "Agent finished mapping the repo");
});
