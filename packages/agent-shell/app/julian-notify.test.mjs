import assert from "node:assert/strict";
import test from "node:test";
import { goalNotificationGroup, notifyGoalWaitsForCheck, removeGoalCheckNotification, resetMissingNotifierReport, verifyNotificationArgs } from "./julian-notify.mjs";

test("the Check it notification names the Area, the Goal, and the link that opens it, and never ignores Do Not Disturb", () => {
  const args = verifyNotificationArgs({ file: "otto/dnd/goal-fix-the-flicker.md", area: "otto/dnd", title: "Fix the flicker" });
  assert.deepEqual(args, [
    "-group", "goal:otto/dnd/goal-fix-the-flicker.md",
    "-title", "dnd",
    "-message", "Fix the flicker. Check it?",
    "-open", "http://127.0.0.1:4321/?goal=otto%2Fdnd%2Fgoal-fix-the-flicker.md",
  ]);
  assert.equal(args.includes("-ignoreDnD"), false);
  assert.equal(goalNotificationGroup("a/b.md"), "goal:a/b.md");
});

test("a missing terminal-notifier is logged once and never blocks", async () => {
  resetMissingNotifierReport();
  const logged = [];
  /** Collects what the notifier logs. */
  const log = (line) => logged.push(line);
  /** A notifier that is not installed. */
  const missing = async () => { const error = new Error("spawn terminal-notifier ENOENT"); error.code = "ENOENT"; throw error; };
  assert.equal(await notifyGoalWaitsForCheck({ file: "a/goal-x.md", area: "a", title: "X" }, { run: missing, log }), false);
  assert.equal(await removeGoalCheckNotification("a/goal-x.md", { run: missing, log }), false);
  assert.deepEqual(logged, ["julian notify: terminal-notifier is not installed; Check it notifications are off"]);
  const calls = [];
  /** A notifier that records its argv. */
  const present = async (command, args) => { calls.push([command, ...args]); };
  assert.equal(await removeGoalCheckNotification("a/goal-x.md", { run: present }), true);
  assert.deepEqual(calls, [["terminal-notifier", "-remove", "goal:a/goal-x.md"]]);
});
