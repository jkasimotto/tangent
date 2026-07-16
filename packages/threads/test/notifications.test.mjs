import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { registerThread, sweep } from "../dist/sdk/index.js";

/** Writes a minimal open thread-<slug>.md fixture in its own node. */
async function writeOpenThread(root, node, slug, body = "Owner: Someone.") {
  const dir = path.join(root, node);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `thread-${slug}.md`), `---\noutcome: test\nstatus: open\nopened: 2026-07-01\n---\n${body}\n`, "utf8");
}

/** Records every notification fired, standing in for terminal-notifier. */
function recordingNotifier() {
  const calls = [];
  return {
    calls,
    /** Records the notification instead of firing a real one. */
    notify: async (input) => { calls.push(input); }
  };
}

test("a thread blocked in two consecutive sweeps notifies exactly once", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-threads-notify-"));
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  await writeOpenThread(vaultRoot, "n", "blocked");
  await registerThread({ slug: "blocked", node: "n", worktree: "/tmp/wt", tmux: "tg-blocked", sessionId: "sess-1", sidecarPath });

  const reader = {
    /** Fake SessionStateReader: always reports the session as idle at a question, simulating a stuck agent. */
    read: async () => ({ status: "active", idleMs: 6 * 60 * 1000, lastStepKind: "assistant_response" }),
    /** Not exercised in this test: every registry entry already has a sessionId. */
    resolveSessionIdByCwd: async () => undefined
  };
  const notifier = recordingNotifier();

  const first = await sweep({ vaultRoot, sidecarPath, now: new Date("2026-07-16T10:00:00Z"), sessionStateReader: reader, notifier });
  const second = await sweep({ vaultRoot, sidecarPath, now: new Date("2026-07-16T10:15:00Z"), sessionStateReader: reader, notifier });

  assert.deepEqual(first.notifiedSlugs, ["blocked"]);
  assert.deepEqual(second.notifiedSlugs, []);
  assert.equal(notifier.calls.length, 1);
});

test("leaving and re-entering a notifiable state notifies again", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-threads-notify-"));
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  await writeOpenThread(vaultRoot, "n", "blocked");
  await registerThread({ slug: "blocked", node: "n", worktree: "/tmp/wt", tmux: "tg-blocked", sessionId: "sess-1", sidecarPath });

  const notifier = recordingNotifier();
  const blockedReader = {
    /** Fake SessionStateReader: always reports the session as idle at a question, simulating a stuck agent. */
    read: async () => ({ status: "active", idleMs: 6 * 60 * 1000, lastStepKind: "assistant_response" }),
    /** Not exercised in this test: every registry entry already has a sessionId. */
    resolveSessionIdByCwd: async () => undefined
  };
  const workingReader = {
    /** Fake SessionStateReader: always reports the session as freshly active, simulating a healthy agent. */
    read: async () => ({ status: "active", idleMs: 0, lastStepKind: "other" }),
    /** Not exercised in this test: every registry entry already has a sessionId. */
    resolveSessionIdByCwd: async () => undefined
  };

  const first = await sweep({ vaultRoot, sidecarPath, now: new Date("2026-07-16T10:00:00Z"), sessionStateReader: blockedReader, notifier });
  const second = await sweep({ vaultRoot, sidecarPath, now: new Date("2026-07-16T10:10:00Z"), sessionStateReader: workingReader, notifier });
  const third = await sweep({ vaultRoot, sidecarPath, now: new Date("2026-07-16T10:20:00Z"), sessionStateReader: blockedReader, notifier });

  assert.deepEqual(first.notifiedSlugs, ["blocked"]);
  assert.deepEqual(second.notifiedSlugs, []);
  assert.deepEqual(third.notifiedSlugs, ["blocked"]);
  assert.equal(notifier.calls.length, 2);
  assert.equal(second.sidecar.notified.blocked, undefined);
});
