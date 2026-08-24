import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

let active = null;

/**
 * Moves one test file and every child it spawns onto a private tmux server.
 * Cleanup kills only that private server, even after an assertion or fixture
 * teardown fails. The user's live tmux socket is never visible to the test.
 */
export function isolateTmuxTests() {
  if (active) return active;
  const root = mkdtempSync(path.join(os.tmpdir(), "tangent-tmux-test-"));
  mkdirSync(path.join(root, `tmux-${process.getuid?.() ?? 0}`), { mode: 0o700 });
  process.env.TMUX_TMPDIR = root;
  delete process.env.TMUX;
  let cleaned = false;
  /** Synchronously settles the private server while the process still owns its environment. */
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const env = { ...process.env, TMUX_TMPDIR: root };
    delete env.TMUX;
    spawnSync("tmux", ["kill-server"], { env, stdio: "ignore", timeout: 2_000 });
    rmSync(root, { recursive: true, force: true });
  };
  process.once("exit", cleanup);
  active = { root, cleanup };
  return active;
}
