import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readPipeline } from "./pipeline-record.mjs";
import { readContinuation } from "./continuation-record.mjs";
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

/** Runs one tmux command, resolving with stdout, rejecting on a nonzero exit. */
function tmux(args) {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

/** True once a tmux session no longer exists. */
async function sessionGone(name) {
  try {
    await tmux(["has-session", "-t", `=${name}`]);
    return false;
  } catch {
    return true;
  }
}

/** Polls until a condition is true or a deadline passes. */
async function waitUntil(condition, { attempts = 60, delayMs = 100 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

const REGISTRY = `# Harnesses

\`\`\`tangent.harnesses.v1
{
  "version": 1,
  "harnesses": [
    { "id": "claude-otto", "label": "Claude · Otto", "command": "CLAUDE_CONFIG_DIR=~/.claude-otto claude" }
  ]
}
\`\`\`
`;

test("worker context handover: the swap contract, its refusals, and the reminder pass", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "context-handover-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const stepDirectory = path.join(root, "step-directory");
  const areaDirectory = path.join(trees, "otto", "test");
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await mkdir(stepDirectory, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), REGISTRY, "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(
    path.join(areaDirectory, "test.md"),
    `---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-pipeline-continue]]\n2. [[goal-solo-continue]]\n\n## Resources\n\n- Repository: ${workspace}\n`,
    "utf8"
  );
  await writeFile(
    path.join(areaDirectory, "goal-pipeline-continue.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The pipeline continues\nsession:\n---\n\n# Pipeline continue\n\n## State\n\nNot started.\n",
    "utf8"
  );
  await writeFile(
    path.join(areaDirectory, "goal-solo-continue.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The solo session continues\nsession:\n---\n\n# Solo continue\n\n## State\n\nNot started.\n",
    "utf8"
  );

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
  const openedSessions = [];
  const pipelinesRoot = path.join(root, "pipelines");
  const continuationsRoot = path.join(root, "continuations");
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      TANGENT_PIPELINES_ROOT: pipelinesRoot,
      TANGENT_CONTINUATIONS_ROOT: continuationsRoot,
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_MAP_STATE_ROOT: path.join(root, "map-state"),
      TANGENT_CONTEXT_HANDOVER_TOKENS: "75000",
      WORKSPACE: workspace,
      AGENT_SHELL_NO_OPEN: "1",
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
      GROQ_API_KEY: "",
      CHAT_SESSION: `context-handover-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await Promise.all(openedSessions.map((session) => tmux(["kill-session", "-t", `=${session}`]).catch(() => {})));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  // ---- A continue on a running step: appends the entry, moves step.session
  // to a fresh name, keeps status running, and the step count is unchanged.
  const started = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file: "otto/test/goal-pipeline-continue.md",
      steps: [{ instruction: "Do the one step.", launch: { harness: "claude-otto" }, path: stepDirectory }],
    }),
  }).then((response) => response.json());
  const step1Session = started.session;
  openedSessions.push(step1Session);
  assert.ok(step1Session, `step 1 got a session: ${JSON.stringify(started)}`);

  const continued = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: step1Session, continue: true, text: "Wrote the design doc, committed abc123. Tests pass." }),
  });
  assert.equal(continued.status, 200);
  const continuedBody = await continued.json();
  assert.equal(continuedBody.status, "continued");
  const step1Continuation = continuedBody.session;
  openedSessions.push(step1Continuation);
  assert.notEqual(step1Continuation, step1Session);
  assert.ok(await tmux(["has-session", "-t", `=${step1Continuation}`]).then(() => true).catch(() => false), "the fresh session exists");
  // The fresh copy is the same step, so it opens in the step's own directory,
  // never in the Area repository.
  const continuationDirectory = await tmux(["display-message", "-p", "-t", `=${step1Continuation}:`, "#{pane_current_path}"]);
  assert.equal(await realpath(continuationDirectory.trim()), await realpath(stepDirectory), "the continuation keeps the step's working directory");

  const record = await readPipeline(pipelinesRoot, "otto/test", "pipeline-continue");
  assert.equal(record.steps.length, 1, "the step count does not change");
  const step = record.steps[0];
  assert.equal(step.status, "running");
  assert.equal(step.session, step1Continuation);
  assert.equal(step.continuations.length, 1);
  assert.equal(step.continuations[0].session, step1Session);
  assert.equal(step.continuations[0].next, step1Continuation);
  assert.equal(step.continuations[0].facts, "Wrote the design doc, committed abc123. Tests pass.");
  assert.ok(!step.continuations[0].failed);

  // ---- A second handover (plain) from the old session is refused and names the new session.
  const plainAgain = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: step1Session, text: "trying to finish the step from the dead session" }),
  });
  assert.equal(plainAgain.status, 409);
  const plainAgainBody = await plainAgain.json();
  assert.match(plainAgainBody.error, new RegExp(step1Continuation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // ---- A second continue from the old session is also refused and names the new session.
  const continueAgain = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: step1Session, continue: true, text: "trying to hand over again from the dead session" }),
  });
  assert.equal(continueAgain.status, 409);
  const continueAgainBody = await continueAgain.json();
  assert.match(continueAgainBody.error, new RegExp(step1Continuation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // ---- A continue from a non-worker session is refused 404.
  const notAWorker = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: "no-such-session-anywhere", continue: true, text: "facts" }),
  });
  assert.equal(notAWorker.status, 404);
  assert.match((await notAWorker.json()).error, /neither a running pipeline step nor a Goal session/);

  // ---- Empty facts are refused 400 (via normalizeMessage, as today).
  const emptyFacts = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: step1Continuation, continue: true, text: "   " }),
  });
  assert.equal(emptyFacts.status, 400);

  // ---- A solo Goal session's continue writes goal-continuation.v1 and rebinds the Goal file.
  const soloStarted = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-solo-continue.md", choice: { harness: "claude-otto" } }),
  }).then((response) => response.json());
  const soloSession = soloStarted.session;
  openedSessions.push(soloSession);
  assert.ok(soloSession, "the solo Goal got a session");

  const soloContinued = await fetch(`${base}/api/goals/handover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: soloSession, continue: true, text: "Read the Goal file, wrote notes." }),
  });
  assert.equal(soloContinued.status, 200);
  const soloContinuedBody = await soloContinued.json();
  assert.equal(soloContinuedBody.status, "continued");
  const soloNext = soloContinuedBody.session;
  openedSessions.push(soloNext);
  assert.notEqual(soloNext, soloSession);

  const soloRecord = await readContinuation(continuationsRoot, "otto/test", "solo-continue");
  assert.equal(soloRecord.schema, "goal-continuation.v1");
  assert.equal(soloRecord.session, soloNext);
  assert.equal(soloRecord.continuations.length, 1);
  assert.equal(soloRecord.continuations[0].session, soloSession);
  assert.equal(soloRecord.continuations[0].next, soloNext);

  const goalNote = await readFile(path.join(areaDirectory, "goal-solo-continue.md"), "utf8");
  assert.match(goalNote, new RegExp(`session:\\s*${soloNext}`));

  // ---- The reminder pass: a fake worker pane whose capture shows a claude
  // statusline (78k/1000k) gets exactly one queued "first" reminder, and a
  // second reconcile pass does not fire "first" again.
  const reminderGoalFile = "otto/test/goal-solo-continue.md";
  const fixtureText = await readFile(path.join(here, "fixtures", "panes", "claude-idle.txt"), "utf8");
  const fixturePath = path.join(root, "claude-fixture.txt");
  await writeFile(fixturePath, fixtureText, "utf8");
  const fakeWorker = `context-reminder-fake-${process.pid}`;
  openedSessions.push(fakeWorker);
  await tmux(["new-session", "-d", "-s", fakeWorker, "-c", workspace]);
  await tmux(["set-option", "-t", fakeWorker, "@tangent_area", "otto/test"]);
  await tmux(["set-option", "-t", fakeWorker, "@tangent_kind", "goal"]);
  await tmux(["set-option", "-t", fakeWorker, "@tangent_phase", "execute"]);
  await tmux(["set-option", "-t", fakeWorker, "@tangent_goal", reminderGoalFile]);
  // cat prints the fixture once, then the pane sits static under sleep: a
  // command outside SHELL_CMDS, so the classifier reads it as an agent pane.
  await tmux(["send-keys", "-t", fakeWorker, `cat ${fixturePath} && sleep 120`, "Enter"]);

  // Wait for the reconcile pass (throttled to 10s) to record the first-level reminder.
  await waitUntil(async () => {
    await fetch(`${base}/api/sessions`);
    const rec = await readContinuation(continuationsRoot, "otto/test", "solo-continue");
    return Boolean(rec?.contextReminders?.[fakeWorker]?.firstAt);
  }, { attempts: 130, delayMs: 500 });
  const afterFirst = await readContinuation(continuationsRoot, "otto/test", "solo-continue");
  const firstAt = afterFirst?.contextReminders?.[fakeWorker]?.firstAt;
  assert.ok(firstAt, "the first-level reminder fired and was recorded");
  assert.equal(afterFirst?.contextReminders?.[fakeWorker]?.repeatAt, null, "78k/1000k is under the 82.5k repeat point at this threshold");

  // A second reconcile pass, well past the 10s throttle, must not fire "first" again.
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  await fetch(`${base}/api/sessions`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterSecond = await readContinuation(continuationsRoot, "otto/test", "solo-continue");
  assert.equal(afterSecond?.contextReminders?.[fakeWorker]?.firstAt, firstAt, "the same first-level timestamp; it did not fire twice");
});
