// The brain never misses an agent's finish. Every brain notice is written to
// disk before it is queued, so it survives a server restart, a brain
// generation handover, and a gap with no live brain. These tests drive the
// real server: a pipeline hands over, the notice lands in the Area's inbox,
// and a new generation's first message lists what no generation read.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { appendNotice, readInbox, unreadNotices, writeInbox } from "./brain-inbox.mjs";
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
  await writeFile(path.join(trees, "harnesses.md"), '```tangent.harnesses.v1\n{"version":1,"harnesses":[{"id":"test","command":"true"}]}\n```\n', "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), '---\ntype: area\n---\n\n# Otto\n\n```tangent.environment.v1\n{"version":1,"defaults":{"launch":{"harness":"test"}}}\n```\n', "utf8");
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
async function completeOnePipeline(base, area, title, handover, caller = "") {
  const goal = await post(base, "/api/goals/create", { area, goal: { title, doneWhen: "The step handed over." }, ...(caller ? { caller } : {}) });
  assert.ok(goal.file, `goal ${title} was created`);
  const started = await post(base, "/api/goals/start", {
    file: goal.file,
    steps: [{ instruction: "Implement the Goal.", command: "sleep 300" }],
    ...(caller ? { caller } : {}),
  });
  assert.ok(started.session, `pipeline for ${title} started: ${JSON.stringify(started)}`);
  const finished = await post(base, "/api/goals/handover", { session: started.session, text: handover });
  assert.equal(finished.status, "complete", `pipeline for ${title} completed: ${JSON.stringify(finished)}`);
  return started.session;
}

test("Julian-scoped live brains can create and start across Areas without widening worker or stale authority", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-cross-area-brain-"));
  const sourceLeaf = `probesource${process.pid}`;
  const trees = await makeTrees(root, sourceLeaf);
  const targetArea = path.join(trees, "neara", "enums");
  await mkdir(targetArea, { recursive: true });
  await writeFile(path.join(trees, "neara", "neara.md"), '---\ntype: area\n---\n\n# Neara\n\n```tangent.environment.v1\n{"version":1,"defaults":{"launch":{"harness":"test"}}}\n```\n', "utf8");
  await writeFile(path.join(targetArea, "enums.md"), "---\ntype: area\n---\n\n# Enums\n", "utf8");
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
  const child = startServer(root, trees, port, "cross-area-brain");
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const sourceBrain = await post(base, "/api/brains/start", { area: `otto/${sourceLeaf}`, instruction: "Orchestrate the source Area." });
  const targetBrain = await post(base, "/api/brains/start", { area: "neara/enums", instruction: "Orchestrate enums." });
  assert.ok(sourceBrain.session, JSON.stringify(sourceBrain));
  assert.ok(targetBrain.session, JSON.stringify(targetBrain));
  sessions.push(sourceBrain.session, targetBrain.session);

  const foreign = await post(base, "/api/goals/create", {
    area: "neara/enums",
    goal: { title: "Original Neara enum case", doneWhen: "The enum case is proved." },
    caller: sourceBrain.session,
  });
  assert.ok(foreign.file, JSON.stringify(foreign));
  const unownedGoal = await readFile(path.join(trees, foreign.file), "utf8");
  assert.match(unownedGoal, /^status: open$/m, "a brain-created Goal starts open");
  assert.match(unownedGoal, /^session:\s*$/m, "caller authority does not bind the brain as owner");
  const foreignStart = await post(base, "/api/goals/start", {
    file: foreign.file,
    steps: [{ instruction: "Prove the enum case.", command: "sleep 300" }],
    caller: sourceBrain.session,
  });
  assert.ok(foreignStart.session, JSON.stringify(foreignStart));
  sessions.push(foreignStart.session);

  const workerCreate = await post(base, "/api/goals/create", {
    area: "neara/enums",
    goal: { title: "Spoofed create", doneWhen: "It must not exist." },
    caller: foreignStart.session,
  });
  assert.match(workerCreate.error, /Workers cannot create Goals/);
  assert.match(workerCreate.error, /Julian directly instructs it or approves the exact Request/);
  const workerStart = await post(base, "/api/goals/start", { file: foreign.file, caller: foreignStart.session });
  assert.match(workerStart.error, /Workers cannot start agents/);

  const ownerConflict = await post(base, "/api/goals/create", {
    area: "neara/enums",
    goal: { title: "Owner conflict", doneWhen: "It must not exist." },
    caller: sourceBrain.session,
    own: targetBrain.session,
  });
  assert.match(ownerConflict.error, /cannot create a Goal owned by live session/);

  const owned = await post(base, "/api/goals/create", {
    area: "neara/enums",
    goal: { title: "Live owner start conflict", doneWhen: "The owner stays unchanged." },
    own: targetBrain.session,
  });
  assert.ok(owned.file, JSON.stringify(owned));
  const ownedGoal = await readFile(path.join(trees, owned.file), "utf8");
  assert.match(ownedGoal, /^status: active$/m, "explicit ownership activates the Goal");
  assert.match(ownedGoal, new RegExp(`^session: ${targetBrain.session}$`, "m"), "explicit ownership binds the named session");
  const startConflict = await post(base, "/api/goals/start", {
    file: owned.file,
    steps: [{ instruction: "Do not replace the owner.", command: "sleep 300" }],
    caller: sourceBrain.session,
  });
  assert.match(startConflict.error, /owned by live session/);

  const sameArea = await post(base, "/api/goals/create", {
    area: `otto/${sourceLeaf}`,
    goal: { title: "Same Area case", doneWhen: "Same-Area behavior works." },
    caller: sourceBrain.session,
  });
  assert.ok(sameArea.file, JSON.stringify(sameArea));
  const sameAreaStart = await post(base, "/api/goals/start", {
    file: sameArea.file,
    steps: [{ instruction: "Prove same-Area behavior.", command: "sleep 300" }],
    caller: sourceBrain.session,
  });
  assert.ok(sameAreaStart.session, JSON.stringify(sameAreaStart));
  sessions.push(sameAreaStart.session);

  const next = await post(base, "/api/brains/handover", { session: sourceBrain.session, text: "Cross-Area probe complete." });
  assert.equal(next.generation, 2, JSON.stringify(next));
  sessions.push(next.session);
  const staleCreate = await post(base, "/api/goals/create", {
    area: "neara/enums",
    goal: { title: "Stale create", doneWhen: "It must not exist." },
    caller: sourceBrain.session,
  });
  assert.match(staleCreate.error, /Workers cannot create Goals/);
  const staleStart = await post(base, "/api/goals/start", { file: foreign.file, caller: sourceBrain.session });
  assert.match(staleStart.error, /Workers cannot start agents/);
});

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
  const step = await completeOnePipeline(base, `otto/${leaf}`, "Notice demo", "Implemented the probe. Unresolved: none.", brain.session);
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
  assert.match(show.prompt, /Tangent recorded these agent events while no generation of this brain was reading/, "the prompt says notices wait on disk");

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

test("an over-long Request answer still reaches the inbox and the next generation", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-notice-long-"));
  const leaf = `probelong${process.pid}`;
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
  const child = startServer(root, trees, port, "notice-long");
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const area = `otto/${leaf}`;
  const brain = await post(base, "/api/brains/start", { area, instruction: "Get the probe Area done." });
  sessions.push(brain.session);

  const created = await post(base, "/api/brains/requests", {
    session: brain.session,
    kind: "decision",
    subject: "Worker harness",
    question: "Should the worker harness come from the Area?",
    proposal: "Take the harness from the Area declaration.",
    detail: "The fallback picks a harness nobody declared.",
  });
  assert.ok(created.request?.id, JSON.stringify(created));

  // Julian pasted a whole brain prompt into the answer. This used to throw
  // inside notifyBrain before anything was written down, so the answer never
  // existed for any generation.
  const note = `Its still so long ${"x".repeat(9000)}`;
  const answered = await post(base, "/api/brains/requests/answer", { area, id: created.request.id, answer: "changes", note });
  assert.equal(answered.request?.answer, "changes", JSON.stringify(answered));

  const inbox = await waitFor("the answer notice on disk", async () => {
    const record = await readInbox(brains, area);
    return record.notices.length ? record : null;
  });
  const notice = inbox.notices[inbox.notices.length - 1];
  assert.match(notice.text, /Julian wants these changes: Its still so long/);
  assert.match(notice.text, /clipped from \d+ characters/);
  assert.ok(notice.text.length <= 4000, `notice is ${notice.text.length} characters`);

  // The next generation is told from the durable Request record, so the
  // answer arrives even when the notice path drops it.
  const next = await post(base, "/api/brains/handover", { session: brain.session, text: "Waiting on the harness answer." });
  assert.equal(next.generation, 2, JSON.stringify(next));
  sessions.push(next.session);
  const show = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(next.session)}`).then((response) => response.json());
  assert.match(show.prompt, /## Requests Julian answered/);
  assert.match(show.prompt, /Julian wants these changes: Its still so long/);
});

/**
 * Paints one detached tmux pane that reads as an agent sitting at an empty
 * composer: a bare `❯ ` prompt with the cursor at the home column. The server
 * primes its own pane for a brain session and the harness command exits at
 * once, so the name is taken and released in a race; the loop keeps trying
 * until it owns the name.
 */
function makeIdleComposerPane(name, dir) {
  const script = "clear; printf '\\342\\235\\257 '; exec sleep 600";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { execFileSync("tmux", ["kill-session", "-t", `=${name}`], { stdio: "ignore" }); } catch {}
    try {
      execFileSync("tmux", ["new-session", "-d", "-s", name, "-c", dir, "bash", "-lc", script], { stdio: "ignore" });
      return;
    } catch {}
  }
  throw new Error(`could not take the pane name ${name}`);
}

/** Reads one pane's visible text; a pane that is gone reads as empty. */
function capturePane(name) {
  try {
    return execFileSync("tmux", ["capture-pane", "-p", "-t", `${name}:`], { encoding: "utf8" });
  } catch {
    return "";
  }
}

test("an over-long Request answer is typed into the live brain pane, not dropped", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-notice-live-"));
  const leaf = `probelive${process.pid}`;
  const trees = await makeTrees(root, leaf);
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
  const child = startServer(root, trees, port, "notice-live");
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const area = `otto/${leaf}`;
  const brain = await post(base, "/api/brains/start", { area, instruction: "Get the probe Area done." });
  sessions.push(brain.session);
  // Let the server finish its own launch attempt before taking the pane name.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  makeIdleComposerPane(brain.session, root);

  const live = await waitFor("the brain pane to read as an idle composer", async () => {
    const body = await fetch(`${base}/api/sessions`).then((response) => response.json()).catch(() => null);
    const list = body?.sessions ?? body ?? [];
    const found = (Array.isArray(list) ? list : []).find((session) => session.name === brain.session);
    return found && found.state === "waiting" && (found.stateDetail === "idle" || found.stateDetail == null) ? found : null;
  }, 200);
  assert.equal(live.state, "waiting", "the brain pane waits at its composer");

  const created = await post(base, "/api/brains/requests", {
    session: brain.session,
    kind: "decision",
    subject: "Worker harness",
    question: "Should the worker harness come from the Area?",
    proposal: "Take the harness from the Area declaration.",
    detail: "The fallback picks a harness nobody declared.",
  });
  assert.ok(created.request?.id, JSON.stringify(created));

  // The exact shape that used to vanish: Julian pastes a whole brain prompt
  // into the answer while the brain is live and waiting for it.
  const marker = `LONGANSWER${process.pid}`;
  const note = `${marker} ${"y".repeat(9000)}`;
  const answered = await post(base, "/api/brains/requests/answer", { area, id: created.request.id, answer: "changes", note });
  assert.equal(answered.request?.answer, "changes", JSON.stringify(answered));

  const text = await waitFor("the answer typed into the live brain pane", async () => {
    const pane = capturePane(brain.session);
    return pane.includes(marker) ? pane : null;
  }, 400);
  assert.match(text, new RegExp(`Julian wants these changes: ${marker}`));
});
