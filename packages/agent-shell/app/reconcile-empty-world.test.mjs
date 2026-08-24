// A live worker is never reported stopped by a server whose tmux world is
// empty. On 2026-08-24 test-spawned servers with an isolated tmux socket
// reconciled the real pipeline records against zero sessions: every running
// step was marked stopped, false "session ended without a handover" notices
// reached the real brain inbox, and the boot sweep cleared real armed
// prompts. The invariant (snapshotCanJudgeAbsence, pipeline-record.mjs): an
// empty sessions snapshot is never proof that one specific session ended, so
// no absence-based transition may act on it. A snapshot that holds at least
// one unrelated session still reaps a genuinely gone step after the grace.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readInbox } from "./brain-inbox.mjs";
import { armedPromptPath } from "./armed-prompts.mjs";
import { PIPELINE_SCHEMA, readPipeline } from "./pipeline-record.mjs";
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

/** Polls until the condition holds, then returns its value. */
async function waitFor(what, check, attempts = 300) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The stop notices ("stopped (its session ended without a handover)") in one Area inbox. */
async function stopNotices(brains, area) {
  const inbox = await readInbox(brains, area);
  return inbox.notices.filter((notice) => notice.text.includes("stopped (its session ended without a handover)"));
}

test("an empty tmux world never stops a running step, flips its Goal, or clears armed prompts", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-empty-world-"));
  const leaf = `probeempty${process.pid}`;
  const area = `otto/${leaf}`;
  const ghost = `ghost-worker-${process.pid}`;
  const unrelated = `unrelated-${process.pid}`;

  const trees = path.join(root, "trees");
  const areaDirectory = path.join(trees, "otto", leaf);
  await mkdir(areaDirectory, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(areaDirectory, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n`, "utf8");
  // Open and unbound: the pipeline record alone drives the reconcile paths
  // under test, and an unbound Goal keeps vault commits out of the fixture.
  await writeFile(
    path.join(areaDirectory, "goal-probe-empty.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The reconcile never lies\nsession:\n---\n\n# Probe empty\n\n## State\n\nRunning.\n",
    "utf8"
  );

  const pipelines = path.join(root, "pipelines");
  const brains = path.join(root, "brains");
  const armed = path.join(root, "armed");
  await mkdir(path.join(pipelines, "otto", leaf), { recursive: true });
  await mkdir(path.join(brains, "otto", leaf), { recursive: true });
  await mkdir(armed, { recursive: true });
  // notifyBrain persists a notice only for an Area some brain record owns.
  await writeFile(
    path.join(brains, "otto", leaf, "brain.json"),
    JSON.stringify({ schema: "area-brain.v1", area, instruction: "Probe.", launch: null, command: "true", label: "", planFile: `${area}/plan-probe.md`, status: "ended", session: null, generations: [] }),
    "utf8"
  );
  const startedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  await writeFile(
    path.join(pipelines, "otto", leaf, "probe-empty.json"),
    JSON.stringify({
      schema: PIPELINE_SCHEMA,
      goal: `${area}/goal-probe-empty.md`,
      area,
      slug: "probe-empty",
      createdAt: startedAt,
      updatedAt: startedAt,
      extraFiles: [],
      steps: [{
        index: 1, instruction: "Prove the reconcile.", launch: null, command: "sleep 300", label: "",
        continueFrom: null, status: "running", session: ghost, startedAt, endedAt: null, handover: null, handoverSource: null,
      }],
    }),
    "utf8"
  );
  await writeFile(
    armedPromptPath(armed, ghost),
    JSON.stringify({ schema: "armed-prompt.v1", session: ghost, armedAt: startedAt, phase: "execute", submit: true, document: "", prompt: "Probe prompt.", extraFiles: [] }),
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
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1",
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: pipelines,
      TANGENT_BRAINS_ROOT: brains,
      TANGENT_ARMED_ROOT: armed,
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "",
      CHAT_SESSION: `empty-world-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${unrelated}`], () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
  });
  await waitForServer(`http://127.0.0.1:${port}/api/sessions`);

  // The boot reconcile and the boot armed-prompt sweep both ran against an
  // empty world by now. Nothing may have judged the ghost session gone.
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  let record = await readPipeline(pipelines, area, "probe-empty");
  assert.equal(record.steps[0].status, "running", "an empty snapshot never stops a running step");
  assert.deepEqual(await stopNotices(brains, area), [], "an empty snapshot never emits a stop notice");
  assert.ok(existsSync(armedPromptPath(armed, ghost)), "an empty snapshot never clears an armed prompt");

  // One unrelated live session makes the world real again: the ghost step,
  // long past the reconcile grace, is now genuinely gone and is reaped once.
  await new Promise((resolve, reject) => execFile("tmux", ["new-session", "-d", "-s", unrelated], (error) => error ? reject(error) : resolve()));
  record = await waitFor("the ghost step to stop against a real snapshot", async () => {
    const current = await readPipeline(pipelines, area, "probe-empty");
    return current.steps[0].status === "stopped" ? current : null;
  });
  assert.equal(record.steps[0].status, "stopped");
  assert.equal((await stopNotices(brains, area)).length, 1, "exactly one stop notice for the reaped step");
});
