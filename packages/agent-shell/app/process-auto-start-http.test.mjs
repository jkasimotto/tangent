import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readBrain } from "./brain-record.mjs";
import { startShellServer } from "./focus-shell-http-fixture.mjs";
import { isolateTmuxTests } from "./tmux-test-isolation.mjs";

isolateTmuxTests();

const here = path.dirname(fileURLToPath(import.meta.url));

/** Polls one async read until it returns a matching value. */
async function eventually(read, matches, attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (matches(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/** Sends one JSON request. */
async function post(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test("auto-start founds the exact Area Brain, creates one linked Job, and recovers every durable phase", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "process-auto-start-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const brains = path.join(root, "brains");
  const processes = path.join(root, "processes");
  const pipelines = path.join(root, "pipelines");
  const openedSessions = [];
  await mkdir(path.join(trees, "otto", "scheduled"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n\n```tangent.environment.v2\n{\"version\":2,\"allow\":[\"test\"]}\n```\n", "utf8");
  await writeFile(path.join(trees, "otto", "scheduled", "scheduled.md"), `---\ntype: area\n---\n\n# Scheduled\n\n## Resources\n\n- Repository: ${workspace}\n`, "utf8");
  await writeFile(path.join(trees, "harnesses.md"), [
    "```tangent.harnesses.v1",
    JSON.stringify({ version: 1, harnesses: [{ id: "test", label: "Test", command: "true" }] }),
    "```",
  ].join("\n"), "utf8");
  await writeFile(path.join(trees, "otto", "scheduled", "process-auto.md"), `---\ntype: process\nwhen: true\nevery: 1m\nstart: auto\npath: ${workspace}\nlaunch: test\n---\n\n# Automatic check\n\nRun the automatic check.\n`, "utf8");
  await writeFile(path.join(root, "launch-memory.json"), JSON.stringify({ "otto/scheduled": { brain: { harness: "test" }, at: "2026-08-31T00:00:00Z" } }), "utf8");
  const { execFile } = await import("node:child_process");
  /** Runs one Git fixture command. */
  const run = (args) => new Promise((resolve, reject) => execFile("git", ["-C", trees, ...args], (error, stdout) => error ? reject(error) : resolve(stdout)));
  await run(["init", "-q"]);
  await run(["-c", "user.name=Test", "-c", "user.email=test@tangent", "add", "-A"]);
  await run(["-c", "user.name=Test", "-c", "user.email=test@tangent", "commit", "-q", "-m", "add: auto Process fixture"]);

  const base = await startShellServer(context, { here, root, trees, workspace, openedSessions, env: { TANGENT_PROCESSES_ROOT: processes, TANGENT_PIPELINES_ROOT: pipelines, TANGENT_RECONCILE_INTERVAL_MS: "600000" } });
  if (!base) return;

  const starting = await eventually(
    () => fetch(`${base}/api/processes?area=otto%2Fscheduled`).then((response) => response.json()).then((body) => body.processes[0]),
    (process) => process?.state === "Starting" && process.brainLive,
  );
  const observed = starting ?? await fetch(`${base}/api/processes?area=otto%2Fscheduled`).then((response) => response.json()).then((body) => body.processes[0]);
  assert.ok(starting, `the scheduler woke or founded the Brain without a browser action: ${JSON.stringify(observed)}`);
  const brain = await readBrain(brains, "otto/scheduled");
  assert.equal(brain.status, "active");
  assert.match(brain.generations.at(-1).firstMessage, /^tangent process start otto\/scheduled\/auto --event /);
  openedSessions.push(brain.session);

  const started = await post(base, "/api/processes/start", { file: "otto/scheduled/process-auto.md", caller: brain.session });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.process.state, "Running");
  assert.equal(started.body.process.lastGoalFile, started.body.goalFile);
  assert.equal(started.body.process.lastJobRun, 1);
  assert.ok(started.body.session);
  openedSessions.push(started.body.session);
  const replay = await post(base, "/api/processes/start", { file: "otto/scheduled/process-auto.md", caller: brain.session });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.session, started.body.session, "a lost Brain response does not create a second Agent");

  const goalText = await readFile(path.join(trees, started.body.goalFile), "utf8");
  assert.match(goalText, /^process: otto\/scheduled\/process-auto\.md$/m);
  const jobFile = JSON.parse(await readFile(path.join(pipelines, "otto", "scheduled", `${path.basename(started.body.goalFile, ".md").replace(/^goal-/, "")}.json`), "utf8"));
  assert.deepEqual(jobFile.runs[0].origin, { kind: "process", processFile: "otto/scheduled/process-auto.md", eventId: starting.eventId, operationId: jobFile.runs[0].origin.operationId });
  const stateFile = path.join(processes, "otto", "scheduled", "auto.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const acceptedAttempt = state.currentEvent.attempts.find((attempt) => attempt.id === state.currentEvent.currentAttemptId);
  assert.equal(acceptedAttempt.status, "started");

  // Simulate the controller losing every checkpoint after `accepted`, while
  // the deterministic Goal, Process-origin Job, and Agent effect survived.
  acceptedAttempt.status = "accepted";
  state.currentEvent.status = "starting";
  state.currentEvent.goalFile = null;
  state.currentEvent.job = null;
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const recovered = await eventually(async () => JSON.parse(await readFile(stateFile, "utf8")), (value) => {
    const attempt = value.currentEvent.attempts.find((item) => item.id === value.currentEvent.currentAttemptId);
    return attempt?.status === "started" && value.currentEvent.job?.agentSession === started.body.session;
  });
  assert.ok(recovered, "the normal Process sweep recovered every accepted effect boundary");
  const recoveredJob = JSON.parse(await readFile(path.join(pipelines, "otto", "scheduled", `${path.basename(started.body.goalFile, ".md").replace(/^goal-/, "")}.json`), "utf8"));
  assert.equal(recoveredJob.runs.length, 1);
  assert.equal(recoveredJob.runs[0].assignments[0].attempts.length, 1);

  // Replay each later durable Process phase as a lost checkpoint. The exact
  // command must keep returning the same Goal, Job, Attempt, and Agent.
  for (const phase of ["goal-created", "job-created"]) {
    const phaseState = JSON.parse(await readFile(stateFile, "utf8"));
    const phaseAttempt = phaseState.currentEvent.attempts.find((item) => item.id === phaseState.currentEvent.currentAttemptId);
    phaseAttempt.status = phase;
    phaseState.currentEvent.status = "starting";
    if (phase === "goal-created") phaseState.currentEvent.job = null;
    await writeFile(stateFile, `${JSON.stringify(phaseState, null, 2)}\n`, "utf8");
    const phaseReplay = await post(base, "/api/processes/start", { file: "otto/scheduled/process-auto.md", caller: brain.session });
    assert.equal(phaseReplay.status, 200, `${phase}: ${JSON.stringify(phaseReplay.body)}`);
    assert.equal(phaseReplay.body.session, started.body.session, `${phase} recovery reused the exact Agent`);
  }

  // Simulate the narrow crash after tmux creation but before the Job Attempt
  // write. The durable prepared receipt must adopt that exact live target.
  const jobPath = path.join(pipelines, "otto", "scheduled", `${path.basename(started.body.goalFile, ".md").replace(/^goal-/, "")}.json`);
  const spawnedJob = JSON.parse(await readFile(jobPath, "utf8"));
  const spawnedRun = spawnedJob.runs[0];
  const spawnedAssignment = spawnedRun.assignments[0];
  const spawnedAttempt = spawnedAssignment.attempts[0];
  const startOperationId = spawnedRun.idempotencyKeys.at(-1);
  spawnedRun.revision -= 1;
  spawnedRun.currentAssignmentId = null;
  spawnedAssignment.status = "pending";
  spawnedAssignment.session = null;
  spawnedAssignment.startedAt = null;
  spawnedAssignment.attempts = [];
  spawnedAssignment.startOperation = {
    id: startOperationId,
    attemptId: spawnedAttempt.id,
    session: spawnedAttempt.session,
    preparedAt: spawnedAttempt.startedAt,
  };
  await writeFile(jobPath, `${JSON.stringify(spawnedJob, null, 2)}\n`, "utf8");
  const spawnedState = JSON.parse(await readFile(stateFile, "utf8"));
  const processAttempt = spawnedState.currentEvent.attempts.find((item) => item.id === spawnedState.currentEvent.currentAttemptId);
  processAttempt.status = "job-created";
  spawnedState.currentEvent.status = "starting";
  spawnedState.currentEvent.job = {
    run: spawnedRun.run,
    revision: spawnedRun.revision,
    assignmentId: spawnedAssignment.id,
    agentSession: null,
    status: "open",
  };
  await writeFile(stateFile, `${JSON.stringify(spawnedState, null, 2)}\n`, "utf8");
  const spawnReplay = await post(base, "/api/processes/start", { file: "otto/scheduled/process-auto.md", caller: brain.session });
  assert.equal(spawnReplay.status, 200, JSON.stringify(spawnReplay.body));
  assert.equal(spawnReplay.body.session, started.body.session, "Agent-spawn recovery adopted the exact live target");
  const adoptedJob = JSON.parse(await readFile(jobPath, "utf8"));
  assert.equal(adoptedJob.runs[0].assignments[0].attempts.length, 1);
  assert.equal(adoptedJob.runs[0].assignments[0].attempts[0].id, spawnedAttempt.id);
  assert.equal(adoptedJob.runs[0].assignments[0].attempts[0].session, started.body.session);
  assert.equal(adoptedJob.runs[0].assignments[0].startOperation, undefined);
});
