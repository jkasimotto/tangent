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
const INSTANCE_ID = `goal-close-http-${process.pid}`;

/** Runs tmux on this test file's private socket. */
function tmux(args) {
  return execFileAsync("tmux", args);
}

/** Creates one tagged tmux fixture. */
async function taggedSession(name, kind, goal = "") {
  await tmux(["new-session", "-d", "-s", name]);
  await tmux(["set-option", "-t", name, "@tangent_agent_shell_instance", INSTANCE_ID]);
  await tmux(["set-option", "-t", name, "@tangent_kind", kind]);
  if (goal) await tmux(["set-option", "-t", name, "@tangent_goal", goal]);
}

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
  await writeFile(path.join(area, "test.md"), "---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-prove-it]]\n2. [[goal-drop-it]]\n");
  await writeFile(path.join(area, "goal-prove-it.md"), "---\ntype: goal\nstatus: open\ndone_when: The result is visible\nsession:\n---\n\n# Prove it\n\n## State\n\nNot started.\n");
  await writeFile(path.join(area, "goal-drop-it.md"), "---\ntype: goal\nstatus: open\ndone_when: The obsolete result is visible\nsession:\n---\n\n# Drop it\n\n## State\n\nNot started.\n");
  const brains = path.join(root, "brains");
  const brainArea = path.join(brains, "otto", "test");
  await mkdir(brainArea, { recursive: true });
  await writeFile(path.join(brainArea, "brain.json"), JSON.stringify({ schema: "area-brain.v1", area: "otto/test", status: "stopped", generation: 1, session: null, generations: [] }));
  await writeFile(path.join(brainArea, "requests.json"), JSON.stringify({ schema: "area-brain-requests.v1", area: "otto/test", requests: [
    { id: "goal-request", kind: "test", subject: "Prove it", question: "Accept it?", proposal: "Close it.", goal: "otto/test/goal-prove-it.md", status: "open" },
    { id: "brain-request", kind: "decision", subject: "Other", question: "Approve it?", proposal: "Use it.", goal: null, status: "open" },
    { id: "drop-request", kind: "approval", subject: "Drop it", question: "Approve it?", proposal: "Close it.", goal: "otto/test/goal-drop-it.md", status: "open" },
  ] }));
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "add: everything"]);
  let port;
  try { port = await freePort(); } catch (error) {
    if (error?.code === "EPERM") return context.skip("This environment does not permit local HTTP listeners.");
    throw error;
  }
  const child = spawn(nodeExecutable(), ["server.mjs"], { cwd: here, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", TREES_ROOT: trees, TANGENT_LOOPS_ROOT: path.join(root, "loops"), WORKSPACE: workspace, AGENT_SHELL_NO_OPEN: "1", AGENT_SHELL_TEST_NO_LAUNCH: "1", TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"), TANGENT_CONTINUATIONS_ROOT: path.join(root, "continuations"), TANGENT_GOAL_CLEANUPS_ROOT: path.join(root, "goal-cleanups"), TANGENT_BRAINS_ROOT: path.join(root, "brains"), TANGENT_ARMED_ROOT: path.join(root, "armed"), AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"), GROQ_API_KEY: "", CHAT_SESSION: `what-happened-http-test-${process.pid}`, TANGENT_SHELL_INSTANCE_ID: INSTANCE_ID }, stdio: ["ignore", "pipe", "pipe"] });
  context.after(async () => { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);
  const doneWorker = `goal-close-worker-${process.pid}`;
  const doneOldWorker = `goal-close-old-${process.pid}`;
  const unrelated = `goal-close-unrelated-${process.pid}`;
  const brainSession = `goal-close-brain-${process.pid}`;
  await taggedSession(doneWorker, "goal", "otto/test/goal-prove-it.md");
  await taggedSession(doneOldWorker, "goal", "otto/test/goal-prove-it.md");
  await taggedSession(unrelated, "goal", "otto/test/goal-other.md");
  await taggedSession(brainSession, "brain");
  const pipelineDir = path.join(root, "pipelines", "otto", "test");
  await mkdir(pipelineDir, { recursive: true });
  await writeFile(path.join(pipelineDir, "prove-it.json"), JSON.stringify({
    schema: "agent-pipeline.v1", goal: "otto/test/goal-prove-it.md", area: "otto/test", slug: "prove-it",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    steps: [
      { index: 1, instruction: "Old", status: "running", session: doneOldWorker, continuations: [{ session: unrelated }] },
      { index: 2, instruction: "Next", status: "pending", session: null },
    ],
  }));
  const edited = await fetch(`${base}/api/goals/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "otto/test/goal-prove-it.md", status: "done", session: "tangent-brain-g4" }) });
  assert.equal(edited.status, 200);
  const liveAfterDone = (await tmux(["list-sessions", "-F", "#{session_name}"])).stdout.trim().split("\n");
  assert.ok(!liveAfterDone.includes(doneWorker));
  assert.ok(!liveAfterDone.includes(doneOldWorker), "a replaced exact-tagged worker is removed even with a blank Goal binding");
  assert.ok(liveAfterDone.includes(unrelated), "an unrelated worker remains live");
  assert.ok(liveAfterDone.includes(brainSession), "a brain remains live");
  const pipelineAfterDone = JSON.parse(await readFile(path.join(pipelineDir, "prove-it.json"), "utf8"));
  assert.deepEqual(pipelineAfterDone.steps.map((step) => step.status), ["ended", "ended"], "non-final pipeline state retires but history remains");
  assert.equal(pipelineAfterDone.steps[0].continuations[0].session, unrelated, "stale continuation history remains unchanged");
  const { stdout: log } = await execFileAsync("git", ["-C", trees, "log", "-1", "--format=%s%n%b"]);
  assert.match(log, /done in tree/);
  assert.match(log, /Tangent-Tmux: tangent-brain-g4/);
  const vault = await fetch(`${base}/api/vault`).then((response) => response.json());
  assert.equal(vault.recentCloses[0].session, "tangent-brain-g4");
  assert.ok(vault.recentCloses[0].at > Date.now() - 60_000);
  const requests = JSON.parse(await readFile(path.join(brainArea, "requests.json"), "utf8")).requests;
  assert.deepEqual([requests[0].status, requests[0].closedReason], ["closed", "goal-done"], "the Goal-linked Request closes with its Goal");
  assert.equal(requests[1].status, "open", "an unrelated live Request stays open");
  assert.deepEqual(requests[1].subjectRef, { type: "brain", area: "otto/test", generation: null }, "the legacy live Request migrates additively");
  const dropped = await fetch(`${base}/api/goals/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "otto/test/goal-drop-it.md", status: "dropped", reason: "The result is obsolete." }) });
  assert.equal(dropped.status, 200);
  const afterDrop = JSON.parse(await readFile(path.join(brainArea, "requests.json"), "utf8")).requests;
  assert.deepEqual([afterDrop[2].status, afterDrop[2].closedReason], ["closed", "goal-dropped"], "the card and CLI mutation route closes a dropped Goal's Request");
});
