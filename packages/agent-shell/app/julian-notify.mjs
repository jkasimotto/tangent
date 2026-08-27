// The one notification Julian gets (D14, ADR-0041): a Goal he flagged
// `verify: yes` entered `verify`, shown as Check it. It goes through
// terminal-notifier so it opens the Goal in Agent Shell. Never `-ignoreDnD`.
// A missing terminal-notifier logs once and never blocks the transition.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const SHELL_URL = "http://127.0.0.1:4321";

let missingReported = false;

/** The notifier group of one Goal file, so its notification can be removed later. */
export function goalNotificationGroup(file) {
  return `goal:${file}`;
}

/** The argv of the notification for one Goal that entered verify. */
export function verifyNotificationArgs({ file, area, title, shellUrl = SHELL_URL }) {
  const leaf = String(area ?? "").split("/").filter(Boolean).pop() ?? area;
  return [
    "-group", goalNotificationGroup(file),
    "-title", String(leaf ?? ""),
    "-message", `${String(title ?? file).trim()}. Check it?`,
    "-open", `${shellUrl}/?goal=${encodeURIComponent(file)}`,
  ];
}

/** Runs terminal-notifier once, or reports once that it is missing. */
async function runNotifier(args, run = execFileAsync, log = console.error) {
  try {
    await run("terminal-notifier", args);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (!missingReported) log("julian notify: terminal-notifier is not installed; Check it notifications are off");
      missingReported = true;
    } else {
      log(`julian notify: ${error?.message ?? error}`);
    }
    return false;
  }
}

/** Sends the Check it notification for one Goal. */
export function notifyGoalWaitsForCheck(goal, { run, log, shellUrl } = {}) {
  return runNotifier(verifyNotificationArgs({ ...goal, ...(shellUrl ? { shellUrl } : {}) }), run, log);
}

/** Removes the Check it notification of one Goal that left verify. */
export function removeGoalCheckNotification(file, { run, log } = {}) {
  return runNotifier(["-remove", goalNotificationGroup(file)], run, log);
}

/** Lets a test reset the once-only missing report. */
export function resetMissingNotifierReport() {
  missingReported = false;
}
