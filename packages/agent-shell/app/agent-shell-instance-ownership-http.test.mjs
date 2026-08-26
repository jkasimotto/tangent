// Two production controllers share one real tmux server in this file. Each
// controller has separate records and one explicit Agent Shell instance ID.
// The tests drive public HTTP routes and lifecycle signals. The other
// instance's worker and brain must remain live after every stop path.

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

/** Returns one available loopback port. */
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Waits for one value from an eventually consistent production path. */
async function waitFor(label, read, attempts = 200) {
  let value;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Posts one JSON body and returns the status and parsed body. */
async function post(base, route, body = {}) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Finds a Node executable that can load this workspace's native modules. */
function nodeExecutable() {
  const candidates = [...(process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, "node")), process.execPath];
  return candidates.find((candidate) => candidate.includes("/.nvm/") && existsSync(candidate))
    ?? candidates.find((candidate) => candidate && existsSync(candidate));
}

/** Writes one independent vault with two managed Goals. */
async function buildInstance(root, leaf) {
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const areaDirectory = path.join(trees, "otto", leaf);
  if (existsSync(path.join(areaDirectory, `${leaf}.md`))) return { trees, workspace, area: `otto/${leaf}` };
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), "```tangent.harnesses.v1\n{\"version\":1,\"harnesses\":[{\"id\":\"test\",\"command\":\"true\"}]}\n```\n", "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(areaDirectory, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n\n## Resources\n\n- Repository: ${workspace}\n\n\`\`\`tangent.environment.v1\n{\"defaults\":{\"brain\":{\"harness\":\"test\"}}}\n\`\`\`\n`, "utf8");
  for (const goal of ["explicit", "reconcile"]) {
    await writeFile(
      path.join(areaDirectory, `goal-${goal}.md`),
      `---\ntype: goal\nstatus: open\ndone_when: ${goal} ownership is isolated\nsession:\n---\n\n# ${goal}\n\n## State\n\nNot started.\n`,
      "utf8",
    );
  }
  return { trees, workspace, area: `otto/${leaf}` };
}

/** Starts one real standalone controller with an explicit runtime identity. */
async function startInstance({ root, instanceId, leaf, children }) {
  const port = await freePort();
  const built = await buildInstance(root, leaf);
  const errors = [];
  const child = spawn(nodeExecutable(), ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: built.trees,
      WORKSPACE: built.workspace,
      TANGENT_SHELL_INSTANCE_ID: instanceId,
      TANGENT_SESSION_OWNERS_ROOT: path.join(root, "session-owners"),
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_CONTINUATIONS_ROOT: path.join(root, "continuations"),
      TANGENT_GOAL_CLEANUPS_ROOT: path.join(root, "goal-cleanups"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      AGENT_SHELL_NO_OPEN: "1",
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_RECONCILE_INTERVAL_MS: "50",
      TANGENT_BRAIN_WAITING_BACKOFF_MS: "0",
      GROQ_API_KEY: "",
      CHAT_SESSION: `${leaf}-chat`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  const health = await waitFor(`${instanceId} health`, async () => {
    try {
      const response = await fetch(`${base}/api/health`);
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  });
  assert.equal(health.instanceId, instanceId, errors.join(""));
  return { ...built, root, instanceId, leaf, base, child, errors };
}

/** Starts one brain and one worker through their public production routes. */
async function startWork(instance, goal) {
  const brain = await post(instance.base, "/api/brains/start", {
    area: instance.area,
    instruction: `Control ${instance.leaf}.`,
  });
  assert.equal(brain.status, 200, JSON.stringify(brain.body));
  const worker = await post(instance.base, "/api/goals/start", {
    file: `${instance.area}/goal-${goal}.md`,
    caller: brain.body.session,
    steps: [{ instruction: `Run ${goal}.`, command: "true" }],
  });
  assert.equal(worker.status, 200, JSON.stringify(worker.body));
  return { brain: brain.body, worker: worker.body };
}

/** True when one exact tmux session remains live. */
async function sessionLive(name) {
  return execFileAsync("tmux", ["has-session", "-t", `=${name}`]).then(() => true, () => false);
}

/** Reads the Agent Shell owner from one live tmux session. */
async function liveOwner(name) {
  const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "-t", `=${name}:`, "#{@tangent_agent_shell_instance}"]);
  return stdout.trim();
}

/** Stops a child controller without touching its tmux sessions. */
async function stopController(child, signal = "SIGTERM") {
  if (child.exitCode !== null) return;
  child.kill(signal);
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

/** Removes only the sessions visible through one live instance's guarded API. */
async function cleanupInstance(instance) {
  try {
    const body = await fetch(`${instance.base}/api/sessions`).then((response) => response.json());
    const sessions = body.sessions ?? body;
    if (!Array.isArray(sessions)) return;
    for (const session of sessions) {
      if (session.name !== `${instance.leaf}-chat`) await post(instance.base, `/api/kill/${encodeURIComponent(session.name)}`);
    }
  } catch {}
}

test("two instances isolate explicit kills, reconciliation, and test cleanup", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-two-instances-"));
  const children = [];
  const instances = [];
  context.after(async () => {
    for (const instance of [...instances].reverse()) await cleanupInstance(instance);
    await Promise.all(children.map((child) => stopController(child)));
    await rm(root, { recursive: true, force: true });
  });
  const one = await startInstance({ root: path.join(root, "one"), instanceId: "ownership-one", leaf: "ownerone", children });
  const two = await startInstance({ root: path.join(root, "two"), instanceId: "ownership-two", leaf: "ownertwo", children });
  instances.push(one, two);
  const first = await startWork(one, "explicit");
  const second = await startWork(two, "explicit");

  assert.equal(await liveOwner(first.worker.session), one.instanceId);
  assert.equal(await liveOwner(second.worker.session), two.instanceId);
  const foreignKill = await post(one.base, `/api/kill/${encodeURIComponent(second.worker.session)}`);
  assert.equal(foreignKill.status, 409, JSON.stringify(foreignKill.body));
  assert.match(foreignKill.body.error, /ownership-two/);
  assert.equal(await sessionLive(second.worker.session), true, "instance one cannot stop instance two's worker");
  const ownKill = await post(one.base, `/api/kill/${encodeURIComponent(first.worker.session)}`);
  assert.equal(ownKill.status, 200, JSON.stringify(ownKill.body));
  assert.equal(await sessionLive(first.worker.session), false, "the owning instance can stop its worker");
  assert.equal(await sessionLive(second.worker.session), true);

  // A done Goal exercises the background closed-Goal cleanup path. The other
  // instance keeps a live worker while this instance reconciles its record.
  const reconciled = await post(one.base, "/api/goals/start", {
    file: `${one.area}/goal-reconcile.md`,
    caller: first.brain.session,
    steps: [{ instruction: "Reconcile this worker.", command: "true" }],
  });
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body));
  const goalFile = path.join(one.trees, one.area, "goal-reconcile.md");
  await writeFile(goalFile, (await readFile(goalFile, "utf8")).replace("status: active", "status: done"), "utf8");
  await waitFor("owned worker reconciliation", async () => !(await sessionLive(reconciled.body.session)));
  assert.equal(await sessionLive(second.worker.session), true, "foreign reconciliation never stops the other worker");

  // Test teardown uses the public kill path with a deliberately mixed list.
  // The first instance removes its own fixture and refuses the second one.
  const ownFixture = `ownerone-cleanup-${process.pid}`;
  const foreignFixture = `ownertwo-cleanup-${process.pid}`;
  assert.equal((await post(one.base, "/api/spawn", { area: one.area, name: ownFixture })).status, 200);
  assert.equal((await post(two.base, "/api/spawn", { area: two.area, name: foreignFixture })).status, 200);
  assert.equal((await post(one.base, `/api/kill/${ownFixture}`)).status, 200);
  assert.equal((await post(one.base, `/api/kill/${foreignFixture}`)).status, 409);
  assert.equal(await sessionLive(foreignFixture), true, "one instance's test cleanup preserves the other fixture");
  assert.equal((await post(two.base, `/api/kill/${foreignFixture}`)).status, 200, "the fixture owner can clean it up");
  assert.equal((await post(two.base, `/api/kill/${second.worker.session}`)).status, 200, "the second owner can still stop its worker");
});

test("brain replacement, stale recovery, rebuild, and shutdown retain the other instance", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-two-brains-"));
  const children = [];
  const instances = [];
  context.after(async () => {
    for (const instance of [...instances].reverse()) await cleanupInstance(instance);
    await Promise.all(children.map((child) => stopController(child)));
    await rm(root, { recursive: true, force: true });
  });
  let one = await startInstance({ root: path.join(root, "one"), instanceId: "brain-owner-one", leaf: "brainone", children });
  const two = await startInstance({ root: path.join(root, "two"), instanceId: "brain-owner-two", leaf: "braintwo", children });
  instances.push(one, two);
  const first = await startWork(one, "explicit");
  const second = await startWork(two, "explicit");

  const handed = await post(one.base, "/api/brains/handover", { session: first.brain.session, text: "Replace only this brain." });
  assert.equal(handed.status, 200, JSON.stringify(handed.body));
  assert.equal(await sessionLive(first.brain.session), false, "brain handover retires its own old generation");
  assert.equal(await sessionLive(second.brain.session), true, "brain handover keeps the other instance's brain");

  // A failed activation delivery is the stale-process recovery kill path.
  const brainFile = path.join(one.root, "brains", "otto", one.leaf, "brain.json");
  const stale = JSON.parse(await readFile(brainFile, "utf8"));
  stale.generations[stale.generations.length - 1].deliveryStatus = "failed";
  await writeFile(brainFile, JSON.stringify(stale), "utf8");
  let lastRecoveryRecord = stale;
  const recovered = await waitFor("owned stale brain recovery", async () => {
    const current = JSON.parse(await readFile(brainFile, "utf8"));
    lastRecoveryRecord = current;
    return current.session !== handed.body.session && await sessionLive(current.session) ? current : null;
  }, 400).catch(async (error) => {
    const tmux = await execFileAsync("tmux", ["list-sessions", "-F", "#{session_name} #{@tangent_agent_shell_instance}"]).then((result) => result.stdout, () => "no tmux");
    throw new Error(`${error.message}\nrecord=${JSON.stringify(lastRecoveryRecord)}\ntmux=${tmux}\n${one.errors.join("")}`);
  });
  assert.equal(await sessionLive(handed.body.session), false);
  assert.equal(await liveOwner(recovered.session), one.instanceId);
  assert.equal(await sessionLive(second.brain.session), true, "stale recovery keeps the foreign brain");
  assert.equal(await sessionLive(second.worker.session), true, "stale recovery keeps the foreign worker");

  // SIGUSR2 is the signal that a successful rebuild worker sends. The tmux
  // sessions survive it, and a replacement with the same ID can own them.
  await stopController(one.child, "SIGUSR2");
  assert.equal(await sessionLive(recovered.session), true, "rebuild keeps this instance's durable brain");
  assert.equal(await sessionLive(second.brain.session), true, "rebuild keeps the other brain");
  one = await startInstance({ root: one.root, instanceId: one.instanceId, leaf: one.leaf, children });
  instances.push(one);
  assert.equal((await fetch(`${one.base}/api/health`).then((response) => response.json())).instanceId, one.instanceId);

  // Ordinary shutdown also leaves durable tmux work alone. A later process
  // with the same explicit ID can still stop the process that it owns.
  await stopController(one.child, "SIGTERM");
  assert.equal(await sessionLive(recovered.session), true, "shutdown keeps the owned brain live");
  assert.equal(await sessionLive(second.brain.session), true, "shutdown keeps the foreign brain live");
  one = await startInstance({ root: one.root, instanceId: one.instanceId, leaf: one.leaf, children });
  instances.push(one);
  const stoppedBrain = await post(one.base, `/api/kill/${encodeURIComponent(recovered.session)}`);
  assert.equal(stoppedBrain.status, 200, JSON.stringify(stoppedBrain.body));
  assert.equal(await sessionLive(recovered.session), false, "the replacement instance can stop its durable brain");
  assert.equal(await sessionLive(second.brain.session), true);

  // A markerless pre-change process is legacy. No instance can claim or stop
  // it through Agent Shell, even when a caller knows its exact name.
  const legacy = `legacy-unowned-${process.pid}`;
  await execFileAsync("tmux", ["new-session", "-d", "-s", legacy]);
  const legacyKill = await post(one.base, `/api/kill/${legacy}`);
  assert.equal(legacyKill.status, 409);
  assert.match(legacyKill.body.error, /no @tangent_agent_shell_instance ownership marker/);
  assert.equal(await sessionLive(legacy), true);
  await execFileAsync("tmux", ["kill-session", "-t", `=${legacy}`]);

  assert.equal((await post(two.base, `/api/kill/${second.worker.session}`)).status, 200);
  assert.equal((await post(two.base, `/api/kill/${second.brain.session}`)).status, 200);
});
