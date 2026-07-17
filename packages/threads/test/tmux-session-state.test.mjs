import assert from "node:assert/strict";
import test from "node:test";

import { TmuxSessionStateReader } from "../dist/sdk/index.js";

const entry = { node: "n", worktree: "/wt", tmux: "tg-pi", runtime: "pi", registeredAt: "2026-07-17T00:00:00Z" };

test("Pi pane alive is working and dead retained pane is ended", async () => {
  const alive = new TmuxSessionStateReader(async () => ({ code: 0, stdout: "0 0\n", stderr: "" }));
  const dead = new TmuxSessionStateReader(async () => ({ code: 0, stdout: "1 0\n", stderr: "" }));
  assert.equal((await alive.read(entry)).status, "active");
  assert.equal((await dead.read(entry)).status, "ended");
});

test("missing tmux session is unknown rather than falsely finished", async () => {
  const reader = new TmuxSessionStateReader(async () => ({ code: 1, stdout: "", stderr: "missing" }));
  assert.equal((await reader.read(entry)).status, "unknown");
});
