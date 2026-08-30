import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { newPipeline, pipelinePath, writePipeline } from "./pipeline-record.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const INSTANCE_ID = `goal-stop-http-${process.pid}`;

/** Runs tmux on this test file's private socket. */
function tmux(args) {
  return execFileAsync("tmux", args);
}

/** Creates one owned Goal worker and returns its immutable tmux target. */
async function goalSession(name, goal) {
  await tmux(["new-session", "-d", "-s", name, "tail -f /dev/null"]);
  const target = (await tmux(["display-message", "-p", "-t", `=${name}:`, "#{session_id}"])).stdout.trim();
  for (const [key, value] of Object.entries({
    "@tangent_agent_shell_instance": INSTANCE_ID,
    "@tangent_area": "neara/hedno",
    "@tangent_kind": "goal",
    "@tangent_goal": goal,
  })) await tmux(["set-option", "-t", target, key, value]);
  return target;
}

/** Creates one running queue assignment for an exact worker target. */
async function runningQueue(root, slug, session, target) {
  const record = newPipeline({
    goal: `neara/hedno/goal-${slug}.md`, area: "neara/hedno", slug,
    steps: [{ instruction: "Implement the correction.", launch: { harness: "codex", model: "sol", effort: "high" } }],
  });
  const assignment = record.assignments[0];
  assignment.status = "running";
  assignment.session = session;
  assignment.startedAt = new Date().toISOString();
  assignment.attempts = [{ id: `${slug}-attempt`, session, target, startedAt: assignment.startedAt }];
  record.currentAssignmentId = assignment.id;
  await writePipeline(root, record);
  return pipelinePath(root, "neara/hedno", slug);
}

/** Reserves one local fixture port. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Waits until Agent Shell serves the browser surface. */
async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent Shell did not start at ${url}`);
}

/** Finds the Node executable used by the repository test fixtures. */
function nodeExecutable() {
  const candidates = [...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")), process.execPath];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate)) ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

test("Work Stop terminates the exact Hedno target and reconciles stale targets without killing replacements", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hedno-stop-http-"));
  const trees = path.join(root, "trees");
  const pipelines = path.join(root, "pipelines");
  const area = path.join(trees, "neara", "hedno");
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "neara", "neara.md"), "---\ntype: area\n---\n\n# Neara\n");
  await writeFile(path.join(area, "hedno.md"), "---\ntype: area\n---\n\n# Hedno\n\n## Goals\n\n1. [[goal-land-split-join-target-type]]\n2. [[goal-stale-worker]]\n");
  for (const slug of ["land-split-join-target-type", "stale-worker"]) {
    await writeFile(path.join(area, `goal-${slug}.md`), `---\ntype: goal\nstatus: active\ndone_when: Stop ${slug}.\nsession:\n---\n\n# ${slug}\n`);
  }
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "add: stop fixture"]);

  const exactName = `hedno-land-split-join-target-type-${process.pid}`;
  const exactGoal = "neara/hedno/goal-land-split-join-target-type.md";
  const exactTarget = await goalSession(exactName, exactGoal);
  const exactQueue = await runningQueue(pipelines, "land-split-join-target-type", exactName, exactTarget);

  const replacementName = `hedno-stale-worker-${process.pid}`;
  const replacementGoal = "neara/hedno/goal-stale-worker.md";
  const staleTarget = "$999999";
  const replacementTarget = await goalSession(replacementName, replacementGoal);
  const staleQueue = await runningQueue(pipelines, "stale-worker", replacementName, staleTarget);

  let port;
  try { port = await freePort(); } catch (error) {
    if (error?.code === "EPERM") return context.skip("This environment does not permit local HTTP listeners.");
    throw error;
  }
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env, PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees,
      WORKSPACE: root, AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: pipelines, TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_REPAIRS_ROOT: path.join(root, "repairs"), TANGENT_SESSION_OWNERS_ROOT: path.join(root, "owners"),
      TANGENT_CONTINUATIONS_ROOT: path.join(root, "continuations"), TANGENT_GOAL_CLEANUPS_ROOT: path.join(root, "cleanups"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"), TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"), GROQ_API_KEY: "",
      CHAT_SESSION: `hedno-stop-chat-${process.pid}`, TANGENT_SHELL_INSTANCE_ID: INSTANCE_ID,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  /** Sends the same fenced request as the visible Work Stop control. */
  const stop = (body) => fetch(`${base}/api/goals/stop`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const exactResponse = await stop({ goal: exactGoal, expectedSession: exactName, expectedTarget: exactTarget });
  assert.equal(exactResponse.status, 200, await exactResponse.text());
  await assert.rejects(tmux(["has-session", "-t", exactTarget]), /can't find session|no server running/);
  const endedExact = JSON.parse(await readFile(exactQueue, "utf8"));
  assert.equal(endedExact.status, "canceled");
  assert.equal(endedExact.assignments[0].status, "ended");
  assert.ok(endedExact.assignments[0].attempts[0].endedAt);
  assert.equal(endedExact.assignments[0].attempts[0].result.type, "canceled");

  const staleResponse = await stop({ goal: replacementGoal, expectedSession: replacementName, expectedTarget: staleTarget });
  assert.equal(staleResponse.status, 200, await staleResponse.text());
  await tmux(["has-session", "-t", replacementTarget]);
  const endedStale = JSON.parse(await readFile(staleQueue, "utf8"));
  assert.equal(endedStale.status, "canceled", "an absent old target still reconciles its stored assignment");
  assert.equal(endedStale.assignments[0].status, "ended");
  assert.match(await readFile(path.join(area, "goal-land-split-join-target-type.md"), "utf8"), /status: active/);
  assert.match(await readFile(path.join(area, "goal-stale-worker.md"), "utf8"), /status: active/);
});
