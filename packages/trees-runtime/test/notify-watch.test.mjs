import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { watchAgentRunNotifications } from "../dist/notify/index.js";

/** A fake runtime whose capture() returns the next scripted pane snapshot each poll. */
function scriptedRuntime(snapshots) {
  let i = 0;
  return {
    id: "tmux",
    /** Returns the next scripted pane snapshot. */
    async capture() {
      const text = snapshots[Math.min(i, snapshots.length - 1)];
      i += 1;
      return { sessionId: "t1", text, lines: text.split("\n"), capturedAt: new Date().toISOString() };
    }
  };
}

test("watcher notifies on needs-input then done, then exits", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "treesnotify-"));
  const out = path.join(dir, "pings.txt");
  const client = {
    /** Fake projection snapshot. */
    async projection() { return { entities: [{ id: "e1", path: "alpha/beta", title: "Beta" }], agentRuns: [], terminalSessions: [] }; }
  };
  const agentRun = { id: "run1", entityId: "e1", terminalSessionId: "t1", status: "running", startedAt: new Date().toISOString() };
  const terminalSession = { id: "t1", runtimeId: "tmux", runtimeRef: {} }; // no tmux name -> no real tmux shelling

  await watchAgentRunNotifications({
    client,
    agentRun,
    runtime: scriptedRuntime(["Claude needs permission to run a command", "All tasks complete. done."]),
    terminalSession,
    config: { driver: { type: "custom", template: `printf '%s\\n' "{title}" >> ${out}` }, pollSeconds: 1, events: { done: true, needsInput: true, failed: false } }
  });

  for (let i = 0; i < 50 && (!existsSync(out) || readFileSync(out, "utf8").split("\n").filter(Boolean).length < 2); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const lines = readFileSync(out, "utf8").split("\n").filter(Boolean);
  assert.deepEqual(lines, ["Agent needs you: Beta", "Agent done: Beta"]);
});

test("watcher honors disabled events (no needs-input ping)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "treesnotify-"));
  const out = path.join(dir, "pings.txt");
  const client = {
    /** Fake projection snapshot. */
    async projection() { return { entities: [{ id: "e1", path: "alpha", title: "Alpha" }], agentRuns: [], terminalSessions: [] }; }
  };
  const agentRun = { id: "run1", entityId: "e1", terminalSessionId: "t1", status: "running", startedAt: new Date().toISOString() };
  const terminalSession = { id: "t1", runtimeId: "tmux", runtimeRef: {} };

  await watchAgentRunNotifications({
    client,
    agentRun,
    runtime: scriptedRuntime(["needs permission to write", "done."]),
    terminalSession,
    config: { driver: { type: "custom", template: `printf '%s\\n' "{title}" >> ${out}` }, pollSeconds: 1, events: { done: true, needsInput: false, failed: false } }
  });

  await new Promise((r) => setTimeout(r, 200));
  const lines = existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean) : [];
  assert.deepEqual(lines, ["Agent done: Alpha"]);
});
