import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { registerThread, sweep } from "../dist/sdk/index.js";

const now = new Date("2026-07-16T12:00:00Z");
const noopNotifier = {
  /** Fake notifier that discards every notification, standing in for terminal-notifier. */
  notify: async () => {}
};

/**
 * Fake SessionStateReader that only resolves a session id when asked to match a specific worktree,
 * mirroring the real SqliteSessionStateReader's cwd-matching contract without touching SQLite.
 */
function fakeCwdReader({ worktree, sessionId, state }) {
  const calls = { resolveSessionIdByCwd: [], read: [] };
  return {
    calls,
    /** Resolves the fixed sessionId only when asked about the matching worktree, mirroring the real cwd-matching contract. */
    async resolveSessionIdByCwd(candidateWorktree) {
      calls.resolveSessionIdByCwd.push(candidateWorktree);
      return candidateWorktree === worktree ? sessionId : undefined;
    },
    /** Returns the fixed fake state only for the matching sessionId. */
    async read(candidateSessionId) {
      calls.read.push(candidateSessionId);
      return candidateSessionId === sessionId ? state : undefined;
    }
  };
}

test("a registry entry with only a worktree path gets its session resolved by cwd and states derive correctly", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "tangent-threads-cwd-"));
  const sidecarPath = path.join(vaultRoot, "..", "sidecar-" + path.basename(vaultRoot) + ".json");
  const worktree = "/tmp/otto-clearances-structure-tab";

  const nodeDir = path.join(vaultRoot, "neara", "pgande", "autodesign");
  await mkdir(nodeDir, { recursive: true });
  await writeFile(path.join(nodeDir, "thread-clearances.md"), "---\noutcome: clearances into structure tab\nstatus: open\nopened: 2026-07-15\n---\nOwner: Chris.\n", "utf8");

  // Dispatch could not observe the session id at register time, so it registers with only the worktree.
  await registerThread({ slug: "clearances", node: "neara/pgande/autodesign", worktree, tmux: "tg-clearances", sidecarPath, now });

  const reader = fakeCwdReader({
    worktree,
    sessionId: "sess-resolved-by-cwd",
    state: { status: "active", idleMs: 6 * 60 * 1000, lastStepKind: "assistant_response" }
  });

  const result = await sweep({ vaultRoot, sidecarPath, now, sessionStateReader: reader, notifier: noopNotifier });

  assert.equal(result.derived[0].state, "blocked-on-you");
  assert.deepEqual(reader.calls.resolveSessionIdByCwd, [worktree]);
  assert.deepEqual(reader.calls.read, ["sess-resolved-by-cwd"]);

  // The resolved session id is persisted back into the registry so the next sweep can query by id directly.
  assert.equal(result.sidecar.registry.clearances.sessionId, "sess-resolved-by-cwd");
  const persisted = JSON.parse(await readFile(sidecarPath, "utf8"));
  assert.equal(persisted.registry.clearances.sessionId, "sess-resolved-by-cwd");

  const secondReader = fakeCwdReader({
    worktree,
    sessionId: "sess-resolved-by-cwd",
    state: { status: "active", idleMs: 6 * 60 * 1000, lastStepKind: "assistant_response" }
  });
  await sweep({ vaultRoot, sidecarPath, now, sessionStateReader: secondReader, notifier: noopNotifier });
  // With a session id already on file, the second sweep queries by id directly and never re-resolves by cwd.
  assert.deepEqual(secondReader.calls.resolveSessionIdByCwd, []);
  assert.deepEqual(secondReader.calls.read, ["sess-resolved-by-cwd"]);
});
