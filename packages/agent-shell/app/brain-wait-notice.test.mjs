// The brain hears when a step waits on a question. classifyState already
// refines a static pane into detail "decision" (with the question) or
// "draft" (an unsent composer), but reconcilePipelines used to notify the
// brain only for an idle pane. These tests drive the real server and a real
// tmux pane: a pane that sits at a decision menu or an unsent draft past the
// sustained-wait threshold must produce exactly one brain notice, a pane
// that resolves itself sooner must produce none, and a wait that keeps
// sitting there must never notify twice.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readInbox, unreadNotices } from "./brain-inbox.mjs";
import { newPipeline, writePipeline } from "./pipeline-record.mjs";

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

/**
 * Polls until the condition holds, then returns its value. The wait-notice
 * threshold only fires on reconcilePipelines' own 10-second throttle
 * (server.mjs lastReconcile), and each poll lists every live tmux session on
 * the machine, so this needs a wall-clock budget, not a fixed attempt count:
 * a busy machine makes each poll itself slow, not just the number needed.
 */
async function waitFor(what, check, budgetMs = 240_000) {
  const deadline = Date.now() + budgetMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Polls the server so classifyState samples the pane and reconcile can run. */
function pollSessions(base) {
  return fetch(`${base}/api/sessions`).catch(() => {});
}

/** Kills one tmux session; a session that is already gone is not an error. */
async function killSession(name) {
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${name}`], () => resolve()));
}

/** Writes an Area note tree with one Area under otto, keyed by pid so runs never collide. */
async function makeTrees(root, leaf) {
  const trees = path.join(root, "trees");
  const area = path.join(trees, "otto", leaf);
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n`, "utf8");
  return trees;
}

/** Starts one Agent Shell server against the given roots, with a short wait-notice threshold. */
function startServer(root, trees, port, label, waitMinutes) {
  return spawn(process.execPath, ["server.mjs"], {
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
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_BRAIN_WAIT_MINUTES: String(waitMinutes),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "",
      CHAT_SESSION: `${label}-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Stops one child server and waits for it to exit. */
async function stopServer(child) {
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

/** POSTs JSON to the server and returns the parsed body. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

/**
 * Creates a detached tmux session running a raw shell script, bypassing the
 * server's own session-priming: reconcilePipelines only needs the session
 * name to match a pipeline step's `session` field, not any @tangent_* tag.
 * The script's last command must be `exec`'d: tmux reports the pane's
 * current command by inspecting the pty's own process, and a plain (not
 * exec'd) `sleep 300` at the end still leaves that process reported as
 * "bash", which classifyState treats as a shell and skips reading entirely.
 */
function makePane(name, dir, script) {
  execFileSync("tmux", ["new-session", "-d", "-s", name, "-c", dir, "bash", "-lc", script]);
}

/** Hand-builds a one-step running pipeline record and writes it. */
async function writeRunningStep(pipelinesRoot, area, slug, session) {
  const record = newPipeline({
    goal: `${area}/goal-${slug}.md`,
    area,
    slug,
    steps: [{ instruction: "Wait on a decision.", command: "true" }],
  });
  record.steps[0].status = "running";
  record.steps[0].session = session;
  record.steps[0].startedAt = new Date().toISOString();
  await writePipeline(pipelinesRoot, record);
  return record;
}

test("a step stuck at a decision menu past the threshold notifies the brain once with the question, and never twice", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-wait-decision-"));
  const leaf = `probewaitdec${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const area = `otto/${leaf}`;
  const brains = path.join(root, "brains");
  const pipelines = path.join(root, "pipelines");
  const sessions = [];
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
  // 0.05 minutes = 3s: short enough for a test, long enough that the first
  // (immediate) reconcile pass, taken while the pane is still freshly
  // "working", can never itself qualify.
  const child = startServer(root, trees, port, "wait-decision", 0.05);
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await post(base, "/api/brains/start", { area, instruction: "Get the probe Area done." });
  sessions.push(brain.session);

  const sessionName = `probe-wait-decision-${process.pid}`;
  sessions.push(sessionName);
  makePane(sessionName, root, "printf '%s\\n' 'Proceed with the risky migration?' '❯ 1. Yes' '  2. No'; exec sleep 300");
  await writeRunningStep(pipelines, area, "probe-wait-decision", sessionName);

  const withNotice = await waitFor("the decision-wait notice", async () => {
    await pollSessions(base);
    const inbox = await readInbox(brains, area);
    return unreadNotices(inbox).length ? inbox : null;
  });
  const notices = unreadNotices(withNotice);
  assert.equal(notices.length, 1, "exactly one notice for the stuck step");
  assert.match(notices[0].text, /step 1 of 1/);
  assert.match(notices[0].text, /sat at a decision menu/);
  assert.match(notices[0].text, /Proceed with the risky migration\?/, "the notice carries the captured question text");

  // The pane keeps sitting at the same decision, unchanged: further reconcile
  // passes (throttled to one every 10s) must not add a second notice. Soak
  // past that throttle and re-check on every poll, so a stray second notice
  // fails immediately instead of only at the end of the window.
  const soakDeadline = Date.now() + 60_000;
  while (Date.now() < soakDeadline) {
    await pollSessions(base);
    assert.equal(unreadNotices(await readInbox(brains, area)).length, 1, "a repeated identical wait is not renotified");
  }
});

test("a step stuck at an unsent draft past the threshold notifies the brain once", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-wait-draft-"));
  const leaf = `probewaitdraft${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const area = `otto/${leaf}`;
  const brains = path.join(root, "brains");
  const pipelines = path.join(root, "pipelines");
  const sessions = [];
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
  const child = startServer(root, trees, port, "wait-draft", 0.05);
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await post(base, "/api/brains/start", { area, instruction: "Get the probe Area done." });
  sessions.push(brain.session);

  const sessionName = `probe-wait-draft-${process.pid}`;
  sessions.push(sessionName);
  // No trailing newline: the cursor sits right after the typed text, past
  // the composer's home column, which is what makes this a draft rather
  // than an idle empty composer.
  makePane(sessionName, root, "printf '❯ half-typed reply, never sent'; exec sleep 300");
  await writeRunningStep(pipelines, area, "probe-wait-draft", sessionName);

  const withNotice = await waitFor("the draft-wait notice", async () => {
    await pollSessions(base);
    const inbox = await readInbox(brains, area);
    return unreadNotices(inbox).length ? inbox : null;
  });
  const notices = unreadNotices(withNotice);
  assert.equal(notices.length, 1, "exactly one notice for the stuck draft");
  assert.match(notices[0].text, /sat at an unsent draft/);
});

test("a decision pane that resolves before the threshold notifies the brain about nothing", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-wait-resolves-"));
  const leaf = `probewaitok${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const area = `otto/${leaf}`;
  const brains = path.join(root, "brains");
  const pipelines = path.join(root, "pipelines");
  const sessions = [];
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
  const child = startServer(root, trees, port, "wait-resolves", 0.05);
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await post(base, "/api/brains/start", { area, instruction: "Get the probe Area done." });
  sessions.push(brain.session);

  const sessionName = `probe-wait-resolves-${process.pid}`;
  sessions.push(sessionName);
  // The decision menu answers itself well inside the 3s threshold: the pane
  // clears and settles on unrelated static text before any notice could fire.
  makePane(
    sessionName,
    root,
    "printf '%s\\n' 'Proceed with the risky migration?' '❯ 1. Yes' '  2. No'; sleep 1; clear; printf 'answered, continuing\\n'; exec sleep 300"
  );
  await writeRunningStep(pipelines, area, "probe-wait-resolves", sessionName);

  // Poll well past two reconcile passes (throttled to one per 10s) so the
  // negative case gets the same scrutiny as the positive ones above, failing
  // immediately if a notice ever appears rather than only checking at the end.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await pollSessions(base);
    assert.equal(unreadNotices(await readInbox(brains, area)).length, 0, "a step that answers itself in time is never reported");
  }
});
