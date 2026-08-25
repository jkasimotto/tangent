import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

// The vault still holds Goals written before the human assignee concept was
// removed. The server must read them, must project nothing from the old
// field, and must never drop a neighbouring frontmatter line when it edits.
test("a Goal file that still carries assignees loads, projects no assignee, and keeps its other fields", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "legacy-assignees-http-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const area = path.join(trees, "otto", "test");
  await mkdir(area, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n\n## People\n\n- Julian\n- Troy\n");
  await writeFile(path.join(area, "test.md"), "---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-legacy]]\n");
  const legacy = "---\ntype: goal\nstatus: open\ndone_when: The old field is inert\nassignees: [Troy, Brida]\nwaiting_on: Troy\ndue: 2026-09-01\nsession:\n---\n\n# Legacy goal\n\n## State\n\nNot started.\n";
  await writeFile(path.join(area, "goal-legacy.md"), legacy);
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "add: everything"]);
  let port;
  try { port = await freePort(); } catch (error) {
    if (error?.code === "EPERM") return context.skip("This environment does not permit local HTTP listeners.");
    throw error;
  }
  const child = spawn(nodeExecutable(), ["server.mjs"], { cwd: here, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees, TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: workspace, AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1", TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_CONTINUATIONS_ROOT: path.join(root, "continuations"), TANGENT_GOAL_CLEANUPS_ROOT: path.join(root, "goal-cleanups"), TANGENT_BRAINS_ROOT: path.join(root, "brains"), TANGENT_ARMED_ROOT: path.join(root, "armed"), AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"), GROQ_API_KEY: "", CHAT_SESSION: `legacy-assignees-http-test-${process.pid}` }, stdio: ["ignore", "pipe", "pipe"] });
  context.after(async () => { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const vault = await fetch(`${base}/api/vault`).then((response) => response.json());
  const areaEntry = vault.areas.find((entry) => entry.path === "otto/test");
  const goal = areaEntry.goals.find((entry) => entry.slug === "legacy");
  assert.equal(goal.title, "Legacy goal", "the Goal still loads");
  assert.equal(goal.doneWhen, "The old field is inert");
  for (const key of ["assignees", "assigneeKeys", "unassigned", "rosterArea"]) {
    assert.equal(key in goal, false, `the projection drops ${key}`);
  }
  for (const key of ["roster", "rosterArea"]) {
    assert.equal(key in areaEntry, false, `the Area projection drops ${key}`);
  }

  const edited = await fetch(`${base}/api/goals/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "otto/test/goal-legacy.md", title: "Renamed goal" }) });
  assert.equal(edited.status, 200);
  const after = await readFile(path.join(area, "goal-legacy.md"), "utf8");
  assert.match(after, /^# Renamed goal$/m, "the edit applied");
  for (const line of ["assignees: [Troy, Brida]", "waiting_on: Troy", "due: 2026-09-01", "done_when: The old field is inert"]) {
    assert.ok(after.includes(line), `the edit preserves "${line}"`);
  }

  for (const route of ["/api/goals/assignees", "/api/areas/people"]) {
    const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(response.status, 404, `${route} is gone`);
  }
});
