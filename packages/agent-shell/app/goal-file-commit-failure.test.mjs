// A failed git add or vault commit of freshly created goal files must never
// be swallowed: server.mjs used to catch the `git add` error with `.catch(()
// => {})`, so a broken stage left goal files uncommitted with no trace of
// why. This test drives the real server against a vault that is not a git
// repository, so the add step in createGoalSet fails for real, and proves
// the failure reaches the server log with the goal file paths and the git
// error while goal creation itself still succeeds for the caller.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));

/** Reserves and releases one local port for the HTTP test. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

/** Polls until the child server accepts HTTP requests. */
async function waitForServer(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent Shell did not start at ${url}`);
}

test("a failed goal-file stage logs the paths and the git error, and goal creation still succeeds", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-goal-stage-"));
  const trees = path.join(root, "trees");
  const areaDirectory = path.join(trees, "otto", "test");
  await mkdir(areaDirectory, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(areaDirectory, "test.md"), "---\ntype: area\n---\n\n# Test\n", "utf8");
  // No `git init` here: TREES_ROOT is not a git repository, so the `git add`
  // in createGoalSet fails with a real "not a git repository" error.

  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") {
      context.skip("This environment does not permit local HTTP listeners.");
      return;
    }
    throw error;
  }
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      WORKSPACE: path.join(root, "workspace"),
      // Every durable-state root must leave ~/.tangent alone: a test server
      // reconciling the real records against its isolated tmux once marked
      // live pipeline workers stopped (2026-08-24).
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      AGENT_SHELL_NO_OPEN: "1",
      GROQ_API_KEY: "",
      CHAT_SESSION: `goal-stage-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const response = await fetch(`${base}/api/goals/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", goal: { title: "Prove the stage failure is heard", doneWhen: "The log names the paths." } }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.file, JSON.stringify(body));

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match(stderr, /goal stage failed/);
  assert.ok(stderr.includes(body.file), stderr);
  assert.match(stderr, /not a git repository/);
});
