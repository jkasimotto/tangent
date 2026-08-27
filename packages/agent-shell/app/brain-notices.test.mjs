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
import { SESSION_OWNER_OPTION } from "./session-ownership.mjs";
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

/** Returns the stable Agent Shell identity used for one test root. */
function instanceIdFor(root) {
  return `brain-notices-${path.basename(root)}`;
}

/** Kills one tmux session only when this test server owns it. */
async function killSession(name, root) {
  let owner = "";
  try {
    owner = execFileSync("tmux", ["display-message", "-p", "-t", `=${name}:`, `#{${SESSION_OWNER_OPTION}}`], { encoding: "utf8" }).trim();
  } catch {
    return false;
  }
  if (owner !== instanceIdFor(root)) return owner || "legacy";
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${name}`], () => resolve()));
  return true;
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
  await writeFile(path.join(area, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n\n## Resources\n\n- Repository: ${root}\n`, "utf8");
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
      TANGENT_CONTINUATIONS_ROOT: path.join(root, "continuations"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      TANGENT_SHELL_INSTANCE_ID: instanceIdFor(root),
      GROQ_API_KEY: "",
      CHAT_SESSION: `${label}-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("startup converts one live solo worker into the authoritative queue without a legacy write", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-solo-migration-"));
  const leaf = `probesolomigration${process.pid}`;
  const area = `otto/${leaf}`;
  const trees = await makeTrees(root, leaf);
  const goal = `${area}/goal-legacy-solo.md`;
  const session = `legacy-solo-${process.pid}`;
  await writeFile(path.join(trees, goal), `---\ntype: goal\nstatus: active\ndone_when: The legacy worker reports through the queue.\nsession: ${session}\n---\n\n# Legacy solo\n`, "utf8");
  execFileSync("tmux", ["new-session", "-d", "-s", session, "sleep", "300"]);
  execFileSync("tmux", ["set-option", "-t", session, "@tangent_kind", "goal"]);
  execFileSync("tmux", ["set-option", "-t", session, "@tangent_phase", "execute"]);
  execFileSync("tmux", ["set-option", "-t", session, "@tangent_area", area]);
  execFileSync("tmux", ["set-option", "-t", session, "@tangent_goal", goal]);
  execFileSync("tmux", ["set-option", "-t", session, "@tangent_launch_command", "sleep 300"]);
  execFileSync("tmux", ["set-option", "-t", session, SESSION_OWNER_OPTION, instanceIdFor(root)]);
  let port;
  try {
    port = await freePort();
  } catch (error) {
    await killSession(session, root);
    if (error?.code === "EPERM") {
      context.skip("This environment does not permit local HTTP listeners.");
      return;
    }
    throw error;
  }
  const child = startServer(root, trees, port, "solo-migration");
  context.after(async () => {
    await killSession(session, root);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);
  const queueFile = path.join(root, "pipelines", area, "legacy-solo.json");
  const queue = await waitFor("the migrated solo queue", async () => {
    try { return JSON.parse(await readFile(queueFile, "utf8")); } catch { return null; }
  });
  assert.equal(queue.schema, "area-goal-queue.v2");
  assert.equal(queue.status, "open");
  assert.ok(queue.goalRevision);
  assert.equal(queue.steps[0].session, session);
  assert.equal(queue.steps[0].attempts[0].kind, "legacy-solo");
  assert.equal(queue.steps[0].command, "sleep 300");
  assert.equal(await readFile(path.join(root, "continuations", area, "legacy-solo.json"), "utf8").then(() => true, () => false), false, "migration never writes the legacy controller");

  const report = await post(base, "/api/goals/handover", {
    session,
    text: "The legacy worker completed through the migrated queue.",
    report: { type: "implementation-result", status: "complete", summary: "Migration complete.", evidenceRefs: ["queue"] },
  });
  assert.equal(report.status, "reported", JSON.stringify(report));
  assert.equal(report.pipeline.status, "complete");
});

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
  assert.ok(started.pipeline?.steps?.some((step) => step.session === started.session), `pipeline did not bind ${started.session}: ${JSON.stringify(started)}`);
  const finished = await post(base, "/api/goals/handover", { session: started.session, text: handover });
  assert.equal(finished.status, "noted", `pipeline for ${title} noted: ${JSON.stringify(finished)}`);
  return started.session;
}

test("local callers mutate work across Areas while ownership and queue fences remain", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-cross-area-brain-"));
  const sourceLeaf = `probesource${process.pid}`;
  const trees = await makeTrees(root, sourceLeaf);
  const targetArea = path.join(trees, "neara", "enums");
  await mkdir(targetArea, { recursive: true });
  await writeFile(path.join(trees, "neara", "neara.md"), '---\ntype: area\n---\n\n# Neara\n\n```tangent.environment.v1\n{"version":1,"defaults":{"launch":{"harness":"test"}}}\n```\n', "utf8");
  await writeFile(path.join(targetArea, "enums.md"), `---\ntype: area\n---\n\n# Enums\n\n## Resources\n\n- Repository: ${root}\n`, "utf8");
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
    for (const session of sessions) await killSession(session, root);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const sourceBrain = await post(base, "/api/brains/start", { area: `otto/${sourceLeaf}`, instruction: "Orchestrate the source Area." });
  assert.ok(sourceBrain.session, JSON.stringify(sourceBrain));
  sessions.push(sourceBrain.session);

  const targetGoal = await post(base, "/api/goals/create", {
    area: "neara/enums",
    goal: { title: "Original Neara enum case", doneWhen: "The enum case is proved." },
    caller: sourceBrain.session,
  });
  assert.ok(targetGoal.file, JSON.stringify(targetGoal));
  const unownedGoal = await readFile(path.join(trees, targetGoal.file), "utf8");
  assert.match(unownedGoal, /^status: open$/m, "a brain-created Goal starts open");
  assert.match(unownedGoal, /^session:\s*$/m, "a caller does not become the Goal owner");
  const targetStart = await post(base, "/api/goals/start", {
    file: targetGoal.file,
    steps: [{ instruction: "Prove the enum case.", command: "sleep 300" }],
    caller: sourceBrain.session,
  });
  assert.ok(targetStart.session, JSON.stringify(targetStart));
  sessions.push(targetStart.session);

  const workerCreate = await post(base, "/api/goals/create", {
    area: "neara/enums",
    goal: { title: "Worker-created enum case", doneWhen: "The worker-created case runs." },
    caller: targetStart.session,
  });
  assert.ok(workerCreate.file, JSON.stringify(workerCreate));
  const workerStart = await post(base, "/api/goals/start", {
    file: workerCreate.file,
    steps: [{ instruction: "Run the worker-created case.", command: "sleep 300" }],
    caller: targetStart.session,
  });
  assert.ok(workerStart.session, JSON.stringify(workerStart));
  sessions.push(workerStart.session);

  const owned = await post(base, "/api/goals/create", {
    area: "neara/enums",
    goal: { title: "Live owner start conflict", doneWhen: "The owner stays unchanged." },
    caller: targetStart.session,
    own: targetStart.session,
  });
  assert.ok(owned.file, JSON.stringify(owned));
  const ownedGoal = await readFile(path.join(trees, owned.file), "utf8");
  assert.match(ownedGoal, /^status: active$/m, "explicit ownership activates the Goal");
  assert.match(ownedGoal, new RegExp(`^session: ${targetStart.session}$`, "m"), "explicit ownership binds the named session");
  const startConflict = await post(base, "/api/goals/start", {
    file: owned.file,
    steps: [{ instruction: "Do not replace the owner.", command: "sleep 300" }],
    caller: sourceBrain.session,
  });
  assert.match(startConflict.error, /owned by live session/, "permissive Area access does not steal a live owner");

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
    goal: { title: "Stale caller create", doneWhen: "A historical caller can still invoke a local command." },
    caller: sourceBrain.session,
  });
  assert.ok(staleCreate.file, JSON.stringify(staleCreate));
  const staleStart = await post(base, "/api/goals/start", {
    file: staleCreate.file,
    steps: [{ instruction: "Prove the stale caller is audit provenance only.", command: "sleep 300" }],
    caller: sourceBrain.session,
  });
  assert.ok(staleStart.session, JSON.stringify(staleStart));
  sessions.push(staleStart.session);

  const areaMessage = await post(base, "/api/agents/send", {
    to: "neara/enums",
    from: next.session,
    text: "Review the cross-Area work that already started.",
  });
  assert.equal(areaMessage.target, "area");
  assert.equal(areaMessage.to, "neara/enums");
  assert.equal(areaMessage.via, "area");
  const inboxFile = path.join(root, "brains", "neara", "enums", "inbox.json");
  const inbox = JSON.parse(await readFile(inboxFile, "utf8"));
  assert.ok(inbox.notices.some((notice) => notice.text.includes("command goal-start")), "committed commands reach the target Area inbox");
  assert.ok(inbox.notices.some((notice) => notice.text.includes("Review the cross-Area work")), "Area-addressed messages persist without a live target brain");

  const targetBrain = await post(base, "/api/brains/start", { area: "neara/enums", instruction: "Orchestrate enums." });
  assert.ok(targetBrain.session, JSON.stringify(targetBrain));
  sessions.push(targetBrain.session);
  const targetShow = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(targetBrain.session)}`).then((response) => response.json());
  assert.match(targetShow.prompt, /Review the cross-Area work that already started/, "the later brain reads its logical Area inbox");
  const targetNext = await post(base, "/api/brains/handover", { session: targetBrain.session, text: "Inbox received." });
  assert.equal(targetNext.generation, 2, JSON.stringify(targetNext));
  sessions.push(targetNext.session);
  const staleMessage = await post(base, "/api/agents/send", {
    to: targetBrain.session,
    from: next.session,
    text: "This uses the stale session as a logical Area address.",
  });
  assert.equal(staleMessage.to, "neara/enums");
  assert.equal(staleMessage.via, "brain-session");
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
    for (const session of sessions) await killSession(session, root);
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
    return unreadNotices(inbox).some((notice) => notice.text.includes("Implemented the probe")) ? inbox : null;
  });
  const unreadBeforeRestart = unreadNotices(afterHandover);
  const reportNotice = unreadBeforeRestart.find((notice) => notice.text.includes("Implemented the probe"));
  assert.ok(reportNotice, JSON.stringify(unreadBeforeRestart));
  assert.match(reportNotice.text, /^note: Implemented the probe/);

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
  const unreadAfterRestart = unreadNotices(await readInbox(brains, `otto/${leaf}`)).map((notice) => notice.id);
  for (const notice of unreadBeforeRestart) assert.ok(unreadAfterRestart.includes(notice.id), "notices the brain never read stay unread");

  // Generation handover: generation 1 never read the notice, so generation
  // 2's first message lists it.
  const handover = await post(restarted, "/api/brains/handover", { session: brain.session, text: "Nothing decided yet." });
  assert.equal(handover.status, "started", JSON.stringify(handover));
  assert.equal(handover.generation, 2);
  sessions.push(handover.session);
  const show = await fetch(`${restarted}/api/brains/show?session=${encodeURIComponent(handover.session)}`).then((response) => response.json());
  assert.match(show.prompt, /## Unread messages/);
  assert.match(show.prompt, /note: Implemented the probe/);
  assert.match(show.prompt, /## Unread messages[\s\S]*note: Implemented the probe/, "the prompt includes the durable unread notice");

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
    for (const session of sessions) await killSession(session, root);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await post(base, "/api/brains/start", { area: `otto/${leaf}`, instruction: "Get the probe Area done." });
  sessions.push(brain.session);

  // A brain creates the authoritative queue, then loses its process.
  // The worker's typed report waits durably instead of being dropped.
  const goal = await post(base, "/api/goals/create", { area: `otto/${leaf}`, goal: { title: "Gap demo", doneWhen: "Done." } });
  const started = await post(base, "/api/goals/start", {
    file: goal.file,
    caller: brain.session,
    steps: [{ instruction: "Implement the Goal.", command: "sleep 300" }],
  });
  assert.ok(started.session, JSON.stringify(started));
  assert.equal(await killSession(brain.session, root), true, "the fixture stops only its owned brain");
  await waitFor("the stopped brain to leave the live-session view", async () => {
    const body = await fetch(`${base}/api/sessions`).then((response) => response.json());
    const live = body.sessions ?? body;
    return Array.isArray(live) && !live.some((session) => session.name === brain.session);
  });
  const handed = await post(base, "/api/goals/handover", {
    session: started.session,
    text: "Implemented the gap probe. Unresolved: none.",
    report: { type: "implementation-result", status: "complete", summary: "Implemented the gap probe.", evidenceRefs: [] },
  });
  assert.equal(handed.status, "reported", JSON.stringify(handed));
  const step = started.session;
  sessions.push(step);
  const waiting = await waitFor("the notice on disk", async () => {
    const inbox = await readInbox(brains, `otto/${leaf}`);
    return unreadNotices(inbox).some((notice) => notice.text.includes("submitted implementation-result")) ? inbox : null;
  });
  const reportNotice = unreadNotices(waiting).find((notice) => notice.text.includes("submitted implementation-result"));
  assert.ok(reportNotice, JSON.stringify(unreadNotices(waiting)));

  const resumed = await post(base, "/api/brains/start", { area: `otto/${leaf}`, resume: true });
  assert.equal(resumed.generation, 2, JSON.stringify(resumed));
  sessions.push(resumed.session);
  const show = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(resumed.session)}`).then((response) => response.json());
  assert.match(show.prompt, /## Unread messages/);
  assert.match(show.prompt, /Implemented the gap probe/);
  assert.equal(unreadNotices(await readInbox(brains, `otto/${leaf}`)).length, 0);

  // A later generation is not told again about a notice a generation read.
  const third = await post(base, "/api/brains/handover", { session: resumed.session, text: "Read the notice." });
  assert.equal(third.generation, 3, JSON.stringify(third));
  sessions.push(third.session);
  const thirdShow = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(third.session)}`).then((response) => response.json());
  assert.doesNotMatch(thirdShow.prompt, /## Unread messages\n\n- Goal/);
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
    for (const session of sessions) await killSession(session, root);
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
    for (const session of sessions) await killSession(session, root);
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
  assert.match(show.prompt, /## Unread messages/);
  assert.match(show.prompt, /Julian wants these changes: Its still so long/);
});

/**
 * Paints one detached tmux pane that reads as an agent sitting at an empty
 * composer: a bare `❯ ` prompt with the cursor at the home column. The server
 * primes its own pane for a brain session and the harness command exits at
 * once, so the name is taken and released in a race; the loop keeps trying
 * until it owns the name.
 */
async function makeIdleComposerPane(name, dir, instanceId) {
  const script = "clear; printf '\\342\\235\\257 '; exec sleep 600";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let nameAvailable = false;
    try {
      const owner = execFileSync("tmux", ["display-message", "-p", "-t", `=${name}:`, `#{${SESSION_OWNER_OPTION}}`], { encoding: "utf8" }).trim();
      if (!owner) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      if (owner !== instanceId) throw new Error(`refused to replace ${name}; owner is ${owner}`);
      execFileSync("tmux", ["kill-session", "-t", `=${name}`], { stdio: "ignore" });
      nameAvailable = true;
    } catch (error) {
      if (!String(error?.message ?? "").includes("can't find session")) throw error;
      nameAvailable = true;
    }
    if (!nameAvailable) continue;
    try {
      execFileSync("tmux", ["new-session", "-d", "-s", name, "-c", dir, "bash", "-lc", script], { stdio: "ignore" });
      execFileSync("tmux", ["set-option", "-t", name, SESSION_OWNER_OPTION, instanceId], { stdio: "ignore" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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
    for (const session of sessions) await killSession(session, root);
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
  await makeIdleComposerPane(brain.session, root, instanceIdFor(root));

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
