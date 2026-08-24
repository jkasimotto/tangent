import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));

test("the Agent Shell entry page serves its explicit browser module graph", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-static-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  await Promise.all([mkdir(trees, { recursive: true }), mkdir(workspace, { recursive: true })]);
  const base = await startShellServer(context, { here, root, trees, workspace });
  if (!base) return;

  const home = await fetch(base).then((response) => response.text());
  assert.match(home, /Agent Shell/i);
  assert.match(home, /\/shell\.js/);
  assert.doesNotMatch(home, />Legacy</);

  const shell = await fetch(`${base}/shell.js`).then((response) => response.text());
  assert.match(shell, /createWorkDeskView/);
  assert.match(shell, /createTerminalController/);
  assert.match(shell, /bindShellEvents/);
});
