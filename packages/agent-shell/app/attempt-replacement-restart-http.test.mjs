import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { attemptReplacementPath, readAttemptReplacement } from "./goal-attempt-replacement.mjs";
import { readPipeline } from "./pipeline-record.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const areaName = "otto/restart";
const launch = { harness: "test-shell" };

const harnessRegistry = `# Harnesses

\`\`\`tangent.harnesses.v1
{
  "version": 1,
  "modelSets": {},
  "harnesses": [
    { "id": "test-shell", "label": "Test shell", "command": "sleep 300" }
  ]
}
\`\`\`
`;

/** Waits without involving the controller's runtime scheduler. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Reserves one loopback port for a disposable controller generation. */
async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return address.port;
}

/** Waits until one controller generation serves its first snapshot. */
async function waitForController(base, child, logs) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(`Agent Shell exited during startup.\n${logs.join("")}`);
    }
    try {
      const response = await fetch(`${base}/api/sessions`);
      if (response.ok) return;
    } catch {}
    await delay(50);
  }
  throw new Error(`Agent Shell did not start at ${base}.\n${logs.join("")}`);
}

/** Starts a controller against the same private durable roots and tmux socket. */
async function startController({ root, trees, workspace, instanceId, controllers }) {
  const port = await freePort();
  const logs = [];
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      WORKSPACE: workspace,
      AGENT_SHELL_NO_OPEN: "1",
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
      CHAT_SESSION: `replacement-restart-test-${process.pid}`,
      GROQ_API_KEY: "",
      TANGENT_SHELL_INSTANCE_ID: instanceId,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_SESSION_OWNERS_ROOT: path.join(root, "session-owners"),
      TANGENT_CONTINUATIONS_ROOT: path.join(root, "continuations"),
      TANGENT_GOAL_CLEANUPS_ROOT: path.join(root, "goal-cleanups"),
      TANGENT_ATTEMPT_REPLACEMENTS_ROOT: path.join(root, "attempt-replacements"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"),
      TANGENT_MESSAGE_QUEUE_FILE: path.join(root, "message-queue.json"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      AGENT_SHELL_ACTION_LOG: path.join(root, "actions.jsonl"),
      AGENT_SHELL_REBUILD_STATE: path.join(root, "rebuild-state.json"),
      AGENT_SHELL_REBUILD_LOG: path.join(root, "rebuild.log"),
      TANGENT_RECONCILE_INTERVAL_MS: "600000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const controller = { child, base: `http://127.0.0.1:${port}`, logs };
  controllers.add(controller);
  await waitForController(controller.base, child, logs);
  return controller;
}

/** Stops only the Node controller; its private owned tmux sessions survive. */
async function stopController(controller, controllers) {
  if (!controller || controller.child.exitCode != null || controller.child.signalCode != null) {
    controllers.delete(controller);
    return;
  }
  controller.child.kill("SIGTERM");
  const exited = await Promise.race([
    once(controller.child, "exit").then(() => true),
    delay(2_000).then(() => false),
  ]);
  if (!exited) {
    controller.child.kill("SIGKILL");
    await once(controller.child, "exit");
  }
  controllers.delete(controller);
}

/** Sends one JSON request and parses its JSON response. */
async function jsonRequest(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

/** Lists only sessions on this test process's private tmux server. */
async function privateSessions() {
  try {
    const { stdout } = await execFileAsync("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error?.code === 1) return [];
    throw error;
  }
}

/** Creates the minimal committed vault used by every controller generation. */
async function createVault(trees, workspace) {
  const area = path.join(trees, areaName);
  await mkdir(area, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), harnessRegistry, "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  const slugs = ["unrelated", "starting", "dead-target", "retirement-retry"];
  await writeFile(path.join(area, "restart.md"), [
    "---", "type: area", "---", "", "# Restart", "", "## Goals", "",
    ...slugs.map((slug, index) => `${index + 1}. [[goal-${slug}]]`), "",
  ].join("\n"), "utf8");
  for (const slug of slugs) {
    await writeFile(path.join(area, `goal-${slug}.md`), [
      "---", "type: goal", "status: open", `done_when: ${slug} replacement is exact and restart-safe.`, "session:", "---", "",
      `# ${slug}`, "", "## State", "", "Ready for a replacement restart test.", "",
    ].join("\n"), "utf8");
  }
  await execFileAsync("git", ["-C", trees, "init", "-q"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "add", "-A"]);
  await execFileAsync("git", ["-C", trees, "-c", "user.name=Test", "-c", "user.email=test@tangent", "commit", "-q", "-m", "add: restart fixture"]);
}

/** Starts one stable-ID assignment and returns its authoritative queue. */
async function startGoal(base, slug) {
  const result = await jsonRequest(base, "/api/goals/start", {
    file: `${areaName}/goal-${slug}.md`,
    steps: [{ id: "work", instruction: `Exercise ${slug}.`, launch }],
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.pipeline;
}

/** Creates the exact retry request for a queue's current attempt. */
function replacementRequest(goal, queue, operationId) {
  const assignment = queue.steps.find((item) => item.id === queue.currentAssignmentId);
  return {
    goal,
    assignmentId: assignment.id,
    expectedAttemptId: assignment.attempts.at(-1).id,
    expectedRevision: queue.revision,
    launch,
    operationId,
  };
}

/** Polls an asynchronous restart resumption until it reaches one state. */
async function waitForOperation(root, goal, operationId, status) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const operation = await readAttemptReplacement(path.join(root, "attempt-replacements"), goal, operationId);
    if (operation?.status === status) return operation;
    await delay(50);
  }
  const operation = await readAttemptReplacement(path.join(root, "attempt-replacements"), goal, operationId);
  assert.equal(operation?.status, status, JSON.stringify(operation));
  return operation;
}

test("exact-attempt replacement survives controller restarts without losing either worker", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-replacement-restart-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const pipelines = path.join(root, "pipelines");
  const instanceId = `replacement-restart-${process.pid}`;
  const controllers = new Set();
  let controller = null;
  context.after(async () => {
    for (const running of [...controllers]) await stopController(running, controllers);
    await execFileAsync("tmux", ["kill-server"]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  await createVault(trees, workspace);
  controller = await startController({ root, trees, workspace, instanceId, controllers });

  const unrelatedQueue = await startGoal(controller.base, "unrelated");
  const unrelatedSession = unrelatedQueue.steps[0].session;

  await context.test("restart never guesses readiness for replacement-starting", async () => {
    const goal = `${areaName}/goal-starting.md`;
    const queue = await startGoal(controller.base, "starting");
    const sourceSession = queue.steps[0].session;
    const request = replacementRequest(goal, queue, "restart-while-starting");
    const requested = await jsonRequest(controller.base, "/api/goals/attempts/replace", request);
    assert.equal(requested.response.status, 200, JSON.stringify(requested.body));
    assert.equal(requested.body.operation.status, "replacement-starting");
    const replacementSession = requested.body.operation.replacementTarget.session;

    await stopController(controller, controllers);
    controller = await startController({ root, trees, workspace, instanceId, controllers });
    await delay(350);

    const stillStarting = await readAttemptReplacement(path.join(root, "attempt-replacements"), goal, request.operationId);
    assert.equal(stillStarting.status, "replacement-starting");
    const unchanged = await readPipeline(pipelines, areaName, "starting");
    assert.equal(unchanged.steps[0].session, sourceSession, "restart leaves the source current without durable readiness");
    assert.equal(unchanged.steps[0].attempts.length, 1);
    assert.ok((await privateSessions()).includes(sourceSession));
    assert.ok((await privateSessions()).includes(replacementSession));

    const confirmed = await jsonRequest(controller.base, "/api/goals/attempts/replace", { ...request, confirmed: true });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.operation.status, "complete");
    const promoted = await readPipeline(pipelines, areaName, "starting");
    assert.equal(promoted.steps[0].session, replacementSession);
    assert.equal(promoted.steps[0].attempts.length, 2);
    assert.equal((await privateSessions()).includes(sourceSession), false);
    assert.ok((await privateSessions()).includes(replacementSession));
    assert.ok((await privateSessions()).includes(unrelatedSession));

    await stopController(controller, controllers);
    controller = await startController({ root, trees, workspace, instanceId, controllers });
    const sessionsBeforeRetry = await privateSessions();
    const retried = await jsonRequest(controller.base, "/api/goals/attempts/replace", { ...request, confirmed: true });
    assert.equal(retried.response.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.repeated, true);
    assert.deepEqual(await privateSessions(), sessionsBeforeRetry, "a completed retry neither starts nor retires another worker");
  });

  await context.test("a dead replacement target can never retire the current source", async () => {
    const goal = `${areaName}/goal-dead-target.md`;
    const queue = await startGoal(controller.base, "dead-target");
    const sourceSession = queue.steps[0].session;
    const request = replacementRequest(goal, queue, "replacement-target-died");
    const requested = await jsonRequest(controller.base, "/api/goals/attempts/replace", request);
    assert.equal(requested.response.status, 200, JSON.stringify(requested.body));
    const replacementSession = requested.body.operation.replacementTarget.session;
    await execFileAsync("tmux", ["kill-session", "-t", `=${replacementSession}`]);

    const confirmed = await jsonRequest(controller.base, "/api/goals/attempts/replace", { ...request, confirmed: true });
    assert.equal(confirmed.response.status, 409, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.code, "replacement-not-live");
    assert.equal(confirmed.body.operation.status, "failed");
    const unchanged = await readPipeline(pipelines, areaName, "dead-target");
    assert.equal(unchanged.steps[0].session, sourceSession);
    assert.equal(unchanged.steps[0].attempts.length, 1);
    assert.ok((await privateSessions()).includes(sourceSession), "the exact current source survives a dead successor");
    assert.ok((await privateSessions()).includes(unrelatedSession));

    await stopController(controller, controllers);
    controller = await startController({ root, trees, workspace, instanceId, controllers });
    const afterRestart = await waitForOperation(root, goal, request.operationId, "failed");
    assert.match(afterRestart.error, /source stayed current/);
    assert.equal((await readPipeline(pipelines, areaName, "dead-target")).steps[0].session, sourceSession);
    assert.ok((await privateSessions()).includes(sourceSession));
  });

  await context.test("retirement-incomplete resumes behind both immutable target fences", async () => {
    const goal = `${areaName}/goal-retirement-retry.md`;
    const queue = await startGoal(controller.base, "retirement-retry");
    const sourceSession = queue.steps[0].session;
    const request = replacementRequest(goal, queue, "resume-retirement");
    const requested = await jsonRequest(controller.base, "/api/goals/attempts/replace", request);
    assert.equal(requested.response.status, 200, JSON.stringify(requested.body));
    const replacementSession = requested.body.operation.replacementTarget.session;

    await execFileAsync("tmux", ["set-option", "-t", `=${sourceSession}:`, "@tangent_agent_shell_instance", "temporarily-foreign"]);
    const refused = await jsonRequest(controller.base, "/api/goals/attempts/replace", { ...request, confirmed: true });
    assert.equal(refused.response.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, "retirement-incomplete");
    assert.equal(refused.body.operation.status, "retirement-incomplete");
    const promoted = await readPipeline(pipelines, areaName, "retirement-retry");
    assert.equal(promoted.steps[0].session, replacementSession, "promotion is durable before exact retirement is retried");
    assert.ok((await privateSessions()).includes(sourceSession), "a mismatched source target is never killed");
    assert.ok((await privateSessions()).includes(replacementSession));
    assert.ok((await privateSessions()).includes(unrelatedSession));

    await stopController(controller, controllers);
    await execFileAsync("tmux", ["set-option", "-t", `=${sourceSession}:`, "@tangent_agent_shell_instance", instanceId]);
    controller = await startController({ root, trees, workspace, instanceId, controllers });
    const completed = await waitForOperation(root, goal, request.operationId, "complete");
    assert.equal(completed.sourceOutcome.kind, "retired");
    assert.equal((await privateSessions()).includes(sourceSession), false);
    assert.ok((await privateSessions()).includes(replacementSession));
    assert.ok((await privateSessions()).includes(unrelatedSession));
    const afterResume = await readPipeline(pipelines, areaName, "retirement-retry");
    assert.equal(afterResume.steps[0].session, replacementSession);
    assert.equal(afterResume.steps[0].attempts.length, 2, "resume never promotes the same replacement twice");

    const sessionsBeforeRetry = await privateSessions();
    const retried = await jsonRequest(controller.base, "/api/goals/attempts/replace", { ...request, confirmed: true });
    assert.equal(retried.response.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.repeated, true);
    assert.deepEqual(await privateSessions(), sessionsBeforeRetry);
    const durable = JSON.parse(await readFile(attemptReplacementPath(path.join(root, "attempt-replacements"), goal, request.operationId), "utf8"));
    assert.equal(durable.status, "complete");
  });
});
