import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

/** Reserves one local test port. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Waits until the fixture server accepts requests. */
async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent Shell did not start at ${url}`);
}

/** Finds the Node executable for the fixture process. */
function nodeExecutable() {
  const candidates = [...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")), process.execPath];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate)) ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

test("a close commit records its session and appears in recent closes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "what-happened-http-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const area = path.join(trees, "otto", "test");
  await mkdir(area, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n");
  await writeFile(path.join(area, "test.md"), "---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-prove-it]]\n");
  await writeFile(path.join(area, "goal-prove-it.md"), "---\ntype: goal\nstatus: open\ndone_when: The result is visible\nsession:\n---\n\n# Prove it\n\n## State\n\nNot started.\n");
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "add: everything"]);
  let port;
  try { port = await freePort(); } catch (error) {
    if (error?.code === "EPERM") return context.skip("This environment does not permit local HTTP listeners.");
    throw error;
  }
  const child = spawn(nodeExecutable(), ["server.mjs"], { cwd: here, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees, TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: workspace, AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1", TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_BRAINS_ROOT: path.join(root, "brains"), AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"), GROQ_API_KEY: "", CHAT_SESSION: `what-happened-http-test-${process.pid}` }, stdio: ["ignore", "pipe", "pipe"] });
  context.after(async () => { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);
  const edited = await fetch(`${base}/api/goals/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "otto/test/goal-prove-it.md", status: "done", session: "tangent-brain-g4" }) });
  assert.equal(edited.status, 200);
  const { stdout: log } = await execFileAsync("git", ["-C", trees, "log", "-1", "--format=%s%n%b"]);
  assert.match(log, /done in tree/);
  assert.match(log, /Tangent-Tmux: tangent-brain-g4/);
  const vault = await fetch(`${base}/api/vault`).then((response) => response.json());
  assert.equal(vault.recentCloses[0].session, "tangent-brain-g4");
  assert.ok(vault.recentCloses[0].at > Date.now() - 60_000);
});
