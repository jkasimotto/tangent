// A brain with nothing to do must not replace itself forever. On 2026-08-25
// the otto/tangent brain ran 170 generations between 14:07 and 17:59, one
// about every 50 seconds, each reporting the same unchanged state and doing
// nothing: 3.9 hours of tokens for no work. The server now paces a waiting
// handover on a growing ladder, wakes the paced generation when the pause
// ends, and lets a generation that did something hand over at once. These
// tests drive the real server binary.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WAITING_BACKOFF_MS, createBrainPacing, waitingBackoffMs } from "./brain-pacing.mjs";
import { readBrain } from "./brain-record.mjs";
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
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Kills one tmux session; a session that is already gone is not an error. */
async function killSession(name) {
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${name}`], () => resolve()));
}

/** Writes an Area note tree with one Area under otto, named for this process. */
async function makeTrees(root, leaf) {
  const trees = path.join(root, "trees");
  const area = path.join(trees, "otto", leaf);
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), '```tangent.harnesses.v1\n{"version":1,"harnesses":[{"id":"test","command":"true"}]}\n```\n', "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), '---\ntype: area\n---\n\n# Otto\n\n```tangent.environment.v1\n{"version":1,"defaults":{"launch":{"harness":"test"}}}\n```\n', "utf8");
  await writeFile(path.join(area, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n`, "utf8");
  return trees;
}

/** Starts one Agent Shell server with a short two-rung backoff ladder. */
function startServer(root, trees, port, label, ladder) {
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
      TANGENT_BRAIN_WAITING_BACKOFF_MS: ladder,
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

/** POSTs JSON and returns the status with the parsed body. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Boots one server against a fresh Area, or skips where listeners are refused. */
async function boot(context, label, ladder) {
  const root = await mkdtemp(path.join(os.tmpdir(), `agent-shell-${label}-`));
  const leaf = `probe${label.replace(/[^a-z]/g, "")}${process.pid}`;
  const trees = await makeTrees(root, leaf);
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") return null;
    throw error;
  }
  const child = startServer(root, trees, port, label, ladder);
  const sessions = [];
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);
  return { base, area: `otto/${leaf}`, brains: path.join(root, "brains"), sessions };
}

test("the backoff ladder grows with the waiting streak and stops at the last rung", () => {
  assert.deepEqual(WAITING_BACKOFF_MS, [60_000, 120_000, 300_000, 600_000, 1_200_000, 1_800_000]);
  assert.equal(waitingBackoffMs(0), 60_000);
  assert.equal(waitingBackoffMs(4), 1_200_000);
  assert.equal(waitingBackoffMs(99), 1_800_000, "a sustained waiting streak caps at 30 minutes");
  assert.equal(waitingBackoffMs(1, [5, 7]), 7, "a caller may name its own ladder");
});

test("a generation that did nothing must live out its rung; one action lifts the wait", () => {
  const pacing = createBrainPacing();
  const started = Date.parse("2026-08-25T14:07:00.000Z");
  const generation = { generation: 84, session: "tangent-brain", startedAt: new Date(started).toISOString() };
  const record = { session: "tangent-brain", waitingStreak: 0 };

  const early = pacing.judge(record, generation, started + 30_000);
  assert.equal(early.acted, false);
  assert.equal(early.waitMs, 30_000, "half of the first minute is left");
  assert.equal(early.until, "2026-08-25T14:08:00.000Z");
  assert.equal(pacing.judge(record, generation, started + 61_000).waitMs, 0, "past the rung the waiting handover is allowed");

  record.waitingStreak = 2;
  assert.equal(pacing.judge(record, generation, started + 1_000).waitMs, 299_000, "the third rung is five minutes");
  pacing.noteAction("tangent-brain");
  const acted = pacing.judge(record, generation, started + 1_000);
  assert.equal(acted.acted, true);
  assert.equal(acted.waitMs, 0, "a generation that worked hands over at once");
});

test("a held session comes due once, and a forgotten one never does", () => {
  const pacing = createBrainPacing();
  const now = Date.parse("2026-08-25T14:07:00.000Z");
  pacing.hold("tangent-brain", new Date(now + 60_000).toISOString());
  assert.equal(pacing.due("tangent-brain", now + 30_000), false, "the pause is not over yet");
  assert.equal(pacing.due("tangent-brain", now + 61_000), true);
  assert.equal(pacing.due("tangent-brain", now + 61_000), false, "a wake-up fires once");

  pacing.hold("tangent-brain", new Date(now + 60_000).toISOString());
  pacing.noteAction("tangent-brain");
  assert.equal(pacing.due("tangent-brain", now + 61_000), false, "a brain that acts is no longer asleep");
  pacing.forget("tangent-brain");
  assert.equal(pacing.judge({ session: "tangent-brain", waitingStreak: 0 }, { startedAt: new Date(now).toISOString() }, now + 1_000).acted, false, "a forgotten session starts over as waiting");
});

test("a brain that did nothing waits out its backoff before it may hand over", async (context) => {
  const world = await boot(context, "brainpace", "1500,60000");
  if (!world) {
    context.skip("This environment does not permit local HTTP listeners.");
    return;
  }
  const { base, area, brains, sessions } = world;

  const brain = await post(base, "/api/brains/start", { area, instruction: "Orchestrate the probe Area." });
  assert.equal(brain.body.generation, 1, JSON.stringify(brain.body));
  sessions.push(brain.body.session);

  // The spin loop: a generation that has done nothing, handing over at once.
  const refused = await post(base, "/api/brains/handover", { session: brain.body.session, text: "Pure waiting state, nothing changed." });
  assert.equal(refused.status, 429, JSON.stringify(refused.body));
  assert.match(refused.body.error, /Tangent paces a waiting brain/);
  assert.match(refused.body.error, /End your turn now/);
  const held = await readBrain(brains, area);
  assert.equal(held.generation, 1, "the refused handover started no new generation");
  assert.equal(held.session, brain.body.session, "the old generation is still the brain");
  assert.equal(held.status, "active", "the refused handover leaves the logical brain active");
  assert.equal(held.generations.at(-1).handover, null, "the refused facts were not recorded");

  // The reconcile sweep wakes the paced generation once the pause is over.
  const woken = await waitFor("the wake-up queued for the paced brain", async () => {
    const { agents } = await fetch(`${base}/api/agents`).then((response) => response.json());
    const live = agents.find((agent) => agent.name === brain.body.session);
    return live && live.queued > 0 ? live : null;
  }, 400);
  assert.ok(woken.queued > 0);

  // Past the rung, the same waiting handover is accepted, and the lineage
  // climbs to the next rung.
  const accepted = await post(base, "/api/brains/handover", { session: brain.body.session, text: "Still nothing to do." });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.generation, 2);
  sessions.push(accepted.body.session);
  const climbed = await readBrain(brains, area);
  assert.equal(climbed.waitingStreak, 1, "one waiting handover in a row");

  // Generation 2 is on the second rung: a minute, far past this test.
  const second = await post(base, "/api/brains/handover", { session: accepted.body.session, text: "Nothing again." });
  assert.equal(second.status, 429, JSON.stringify(second.body));
  assert.match(second.body.error, /waiting handover number 2 in a row/);
});

test("a brain that did something hands over at once and resets the ladder", async (context) => {
  const world = await boot(context, "brainacted", "600000");
  if (!world) {
    context.skip("This environment does not permit local HTTP listeners.");
    return;
  }
  const { base, area, brains, sessions } = world;

  const brain = await post(base, "/api/brains/start", { area, instruction: "Orchestrate the probe Area." });
  sessions.push(brain.body.session);
  const first = await post(base, "/api/brains/handover", { session: brain.body.session, text: "Nothing yet." });
  assert.equal(first.status, 429, "a ten-minute rung refuses an idle generation");

  // One real action: this brain creates a Goal. That is the whole difference
  // between a generation that worked and one that only waited.
  const goal = await post(base, "/api/goals/create", {
    area,
    goal: { title: "Pace probe", doneWhen: "The brain acted." },
    caller: brain.body.session,
  });
  assert.ok(goal.body.file, JSON.stringify(goal.body));
  const handover = await post(base, "/api/brains/handover", { session: brain.body.session, text: "Created the probe Goal." });
  assert.equal(handover.status, 200, JSON.stringify(handover.body));
  assert.equal(handover.body.generation, 2);
  sessions.push(handover.body.session);
  const record = await readBrain(brains, area);
  assert.equal(record.waitingStreak, 0, "work keeps the ladder at its first rung");
});

/** Retries a waiting handover until the server accepts it. */
async function handoverWhenAllowed(base, session, text, limitMs = 30_000) {
  const start = Date.now();
  for (;;) {
    const result = await post(base, "/api/brains/handover", { session, text });
    if (result.status === 200) return result;
    assert.equal(result.status, 429, JSON.stringify(result.body));
    if (Date.now() - start > limitMs) throw new Error(`handover never allowed for ${session}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("work drops a lineage that has climbed the ladder back to the first rung", async (context) => {
  const world = await boot(context, "brainreset", "1000,1000,600000");
  if (!world) {
    context.skip("This environment does not permit local HTTP listeners.");
    return;
  }
  const { base, area, brains, sessions } = world;

  const brain = await post(base, "/api/brains/start", { area, instruction: "Orchestrate the probe Area." });
  sessions.push(brain.body.session);

  // Two waiting handovers in a row: the lineage climbs to the third rung.
  const first = await handoverWhenAllowed(base, brain.body.session, "Nothing to do.");
  sessions.push(first.body.session);
  const second = await handoverWhenAllowed(base, first.body.session, "Still nothing.");
  sessions.push(second.body.session);
  assert.equal((await readBrain(brains, area)).waitingStreak, 2);

  // The third rung is ten minutes, so suite load cannot finish the wait.
  const refused = await post(base, "/api/brains/handover", { session: second.body.session, text: "Nothing again." });
  assert.equal(refused.status, 429, JSON.stringify(refused.body));
  assert.match(refused.body.error, /waiting handover number 3 in a row/);

  // One real action lifts a minute-long wait at once, however high the
  // lineage had climbed. A brain that starts working must never be throttled.
  const goal = await post(base, "/api/goals/create", {
    area,
    goal: { title: "Pace probe", doneWhen: "The brain acted." },
    caller: second.body.session,
  });
  assert.ok(goal.body.file, JSON.stringify(goal.body));
  const acted = await post(base, "/api/brains/handover", { session: second.body.session, text: "Created the probe Goal." });
  assert.equal(acted.status, 200, JSON.stringify(acted.body));
  sessions.push(acted.body.session);
  assert.equal((await readBrain(brains, area)).waitingStreak, 0, "work drops the lineage to the first rung");

  // And the ladder really did reset: the next idle generation is told "1".
  const back = await post(base, "/api/brains/handover", { session: acted.body.session, text: "Idle once more." });
  assert.equal(back.status, 429, JSON.stringify(back.body));
  assert.match(back.body.error, /waiting handover number 1 in a row/);
});

test("an answer still reaches a brain that pacing put to sleep", async (context) => {
  // Pacing must never become a second way an answer goes missing, which is
  // the whole subject of this Goal.
  const world = await boot(context, "brainasleep", "600000");
  if (!world) {
    context.skip("This environment does not permit local HTTP listeners.");
    return;
  }
  const { base, area, sessions } = world;

  const brain = await post(base, "/api/brains/start", { area, instruction: "Orchestrate the probe Area." });
  sessions.push(brain.body.session);
  const request = await post(base, "/api/brains/requests", {
    session: brain.body.session,
    kind: "decision",
    subject: "Which way",
    question: "Which way should this go?",
    proposal: "Go the first way.",
    detail: "",
    options: [],
  });
  assert.equal(request.status, 200, JSON.stringify(request.body));

  // Filing the Request bought this generation a free handover. Spend it, then
  // let the fresh generation ask to hand over with nothing done.
  const handed = await post(base, "/api/brains/handover", { session: brain.body.session, text: "Filed the Request." });
  assert.equal(handed.status, 200, JSON.stringify(handed.body));
  const asleep = handed.body.session;
  sessions.push(asleep);
  const refused = await post(base, "/api/brains/handover", { session: asleep, text: "Waiting on the answer." });
  assert.equal(refused.status, 429, JSON.stringify(refused.body));

  // Julian answers while that generation sleeps on a ten-minute rung.
  const before = await fetch(`${base}/api/agents`).then((response) => response.json());
  const queuedBefore = before.agents.find((agent) => agent.name === asleep)?.queued ?? 0;
  const answered = await post(base, "/api/brains/requests/answer", { area, id: request.body.request.id, answer: "approve", note: "Go the first way." });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));

  const woken = await waitFor("the answer queued for the sleeping brain", async () => {
    const { agents } = await fetch(`${base}/api/agents`).then((response) => response.json());
    const live = agents.find((agent) => agent.name === asleep);
    return live && live.queued > queuedBefore ? live : null;
  }, 200);
  assert.ok(woken.queued > queuedBefore, "pacing must never hold back an answer");
});
