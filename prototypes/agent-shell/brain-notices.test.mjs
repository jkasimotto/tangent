// The brain never misses an agent's finish. Every brain notice is written to
// disk before it is queued, so it survives a server restart, a brain
// generation handover, and a gap with no live brain. These tests drive the
// real server: a pipeline hands over, the notice lands in the Area's inbox,
// and a new generation's first message lists what no generation read.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { appendNotice, readInbox, unreadNotices, writeInbox } from "./brain-inbox.mjs";

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
async function waitFor(what, check, attempts = 80) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Kills one tmux session; a session that is already gone is not an error. */
async function killSession(name) {
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${name}`], () => resolve()));
}

/**
 * Writes an Area note tree with one Area under otto. The leaf carries the
 * test process id, so a session left behind by an earlier run can never take
 * the name this run needs.
 */
async function makeTrees(root, leaf) {
  const trees = path.join(root, "trees");
  const area = path.join(trees, "otto", leaf);
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n`, "utf8");
  return trees;
}

/** Starts one Agent Shell server against the given roots. */
function startServer(root, trees, port, label) {
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

/** Runs one Goal as a single-step pipeline and hands its last step over. */
async function completeOnePipeline(base, area, title, handover) {
  const goal = await post(base, "/api/goals/create", { area, goal: { title, doneWhen: "The step handed over." } });
  assert.ok(goal.file, `goal ${title} was created`);
  const started = await post(base, "/api/goals/start", {
    file: goal.file,
    steps: [{ instruction: "Implement the Goal.", command: "sleep 300" }],
  });
  assert.ok(started.session, `pipeline for ${title} started: ${JSON.stringify(started)}`);
  const finished = await post(base, "/api/goals/handover", { session: started.session, text: handover });
  assert.equal(finished.status, "complete", `pipeline for ${title} completed: ${JSON.stringify(finished)}`);
  return started.session;
}

test("a brain notice survives a server restart and reaches the next generation after a handover", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-notice-restart-"));
  const leaf = `probenotice${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const brains = path.join(root, "brains");
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
  let child = startServer(root, trees, port, "notice-restart");
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await post(base, "/api/brains/start", { area: `otto/${leaf}`, instruction: "Get the probe Area done." });
  sessions.push(brain.session);
  assert.equal(brain.generation, 1, JSON.stringify(brain));

  // The brain session runs no agent, so nothing can be typed into it. The
  // notice is written to disk all the same.
  const step = await completeOnePipeline(base, `otto/${leaf}`, "Notice demo", "Implemented the probe. Unresolved: none.");
  sessions.push(step);
  const afterHandover = await waitFor("the notice on disk", async () => {
    const inbox = await readInbox(brains, `otto/${leaf}`);
    return unreadNotices(inbox).length ? inbox : null;
  });
  assert.equal(unreadNotices(afterHandover).length, 1);
  assert.match(unreadNotices(afterHandover)[0].text, /pipeline complete/);
  assert.match(unreadNotices(afterHandover)[0].text, /Implemented the probe/);

  // Restart: the memory queue is gone, the notice is not. The new process
  // queues it again for the generation that is still live.
  await stopServer(child);
  const nextPort = await freePort();
  child = startServer(root, trees, nextPort, "notice-restart-2");
  const restarted = `http://127.0.0.1:${nextPort}`;
  await waitForServer(restarted);
  await waitFor("the notice queued again after the restart", async () => {
    const { agents } = await fetch(`${restarted}/api/agents`).then((response) => response.json());
    const live = agents.find((agent) => agent.name === brain.session);
    return live && live.queued > 0;
  });
  assert.equal(unreadNotices(await readInbox(brains, `otto/${leaf}`)).length, 1, "a notice the brain never read stays unread");

  // Generation handover: generation 1 never read the notice, so generation
  // 2's first message lists it.
  const handover = await post(restarted, "/api/brains/handover", { session: brain.session, text: "Nothing decided yet." });
  assert.equal(handover.status, "started", JSON.stringify(handover));
  assert.equal(handover.generation, 2);
  sessions.push(handover.session);
  const show = await fetch(`${restarted}/api/brains/show?session=${encodeURIComponent(handover.session)}`).then((response) => response.json());
  assert.match(show.prompt, /## Notices you have not read/);
  assert.match(show.prompt, /pipeline complete/);
  assert.match(show.prompt, /Implemented the probe/);
  assert.match(show.prompt, /No message is lost/, "the prompt says notices wait on disk");

  const read = await readInbox(brains, `otto/${leaf}`);
  assert.equal(unreadNotices(read).length, 0, "generation 2 read it, so it is not repeated");
  assert.equal(read.notices[0].deliveredGeneration, 2);
  assert.equal(read.notices[0].deliveredTo, handover.session);
});

test("a notice with no live brain waits on disk and the next generation reads it", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-notice-gap-"));
  const leaf = `probegap${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const brains = path.join(root, "brains");
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
  const child = startServer(root, trees, port, "notice-gap");
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await post(base, "/api/brains/start", { area: `otto/${leaf}`, instruction: "Get the probe Area done." });
  sessions.push(brain.session);
  await killSession(brain.session);

  // No brain session is live now. The pipeline still finishes, and the
  // notice waits instead of being dropped.
  const step = await completeOnePipeline(base, `otto/${leaf}`, "Gap demo", "Implemented the gap probe. Unresolved: none.");
  sessions.push(step);
  const waiting = await waitFor("the notice on disk", async () => {
    const inbox = await readInbox(brains, `otto/${leaf}`);
    return unreadNotices(inbox).length ? inbox : null;
  });
  assert.equal(unreadNotices(waiting).length, 1);
  assert.match(unreadNotices(waiting)[0].text, /pipeline complete/);

  const resumed = await post(base, "/api/brains/start", { area: `otto/${leaf}`, resume: true });
  assert.equal(resumed.generation, 2, JSON.stringify(resumed));
  sessions.push(resumed.session);
  const show = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(resumed.session)}`).then((response) => response.json());
  assert.match(show.prompt, /## Notices you have not read/);
  assert.match(show.prompt, /Implemented the gap probe/);
  assert.equal(unreadNotices(await readInbox(brains, `otto/${leaf}`)).length, 0);

  // A later generation is not told again about a notice a generation read.
  const third = await post(base, "/api/brains/handover", { session: resumed.session, text: "Read the notice." });
  assert.equal(third.generation, 3, JSON.stringify(third));
  sessions.push(third.session);
  const thirdShow = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(third.session)}`).then((response) => response.json());
  assert.doesNotMatch(thirdShow.prompt, /## Notices you have not read/);
});

test("a sweep queues an unread notice for the live brain once, and never twice", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-notice-sweep-"));
  const leaf = `probesweep${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const brains = path.join(root, "brains");
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
  const child = startServer(root, trees, port, "notice-sweep");
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await post(base, "/api/brains/start", { area: `otto/${leaf}`, instruction: "Get the probe Area done." });
  sessions.push(brain.session);

  // A notice that is on disk but in no queue: the shape of a delivery that
  // failed, or of a queue entry that died with an older generation's session.
  const inbox = await readInbox(brains, `otto/${leaf}`);
  appendNotice(inbox, `Goal sweep-demo: pipeline complete. Last handover: written while nothing queued it.`);
  await writeInbox(brains, inbox);

  /** The brain's queue length as the desk sees it; the poll also runs a reconcile pass. */
  const queuedForBrain = async () => {
    await fetch(`${base}/api/sessions`);
    const { agents } = await fetch(`${base}/api/agents`).then((response) => response.json());
    return agents.find((agent) => agent.name === brain.session)?.queued ?? 0;
  };
  await waitFor("the sweep to queue the notice", async () => (await queuedForBrain()) > 0, 300);
  // More sweeps do not queue it again while it is on its way.
  for (let pass = 0; pass < 3; pass += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await queuedForBrain(), 1, "a notice on its way is queued once");
  assert.equal(unreadNotices(await readInbox(brains, `otto/${leaf}`)).length, 1, "a queued notice the brain did not read stays unread");
});
