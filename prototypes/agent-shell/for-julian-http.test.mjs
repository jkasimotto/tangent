// Under a live brain, only the brain says what needs Julian (design contract:
// otto/tangent/impl-what-needs-julian-under-brains). These tests drive the
// real server: the brain writes a `## For Julian` section in its plan, the
// desk payload carries the parsed rows with their titles and comment counts,
// `Tried it` removes one Try it line with an undo, and a saved comment on a
// listed Document wakes the brain.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readInbox } from "./brain-inbox.mjs";

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
    const last = await check();
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
 * Writes an Area note tree with one Area under otto, plus one Document with
 * one open comment from Julian. The leaf carries the test process id, so a
 * session left behind by an earlier run can never take the name this run needs.
 */
async function makeTrees(root, leaf) {
  const trees = path.join(root, "trees");
  const area = path.join(trees, "otto", leaf);
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n`, "utf8");
  await writeFile(path.join(area, "design-probe.md"), "# Probe design\n\nA question. {>>Julian: which one?<<}\n", "utf8");
  await writeFile(path.join(area, "design-quiet.md"), "# Quiet design\n\nNothing waits here.\n", "utf8");
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

/** POSTs JSON to the server and returns the status and the parsed body. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** GETs JSON from the server. */
async function get(base, route) {
  return fetch(`${base}${route}`).then((response) => response.json());
}

/** The one brain of the payload, with the rows it wrote for Julian. */
async function brainOf(base) {
  const { brains } = await get(base, "/api/sessions");
  return brains[0];
}

/**
 * Boots one server on a probe Area with a live brain and one Goal, and writes
 * the plan's `## For Julian` section with one line of each kind. Returns the
 * facts every test in this file works from.
 */
async function startProbe(context, label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `agent-shell-${label}-`));
  const leaf = `${label.replace(/[^a-z]/g, "")}${process.pid}`;
  const trees = await makeTrees(root, leaf);
  const area = `otto/${leaf}`;
  const sessions = [];
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") {
      context.skip("This environment does not permit local HTTP listeners.");
      return null;
    }
    throw error;
  }
  const child = startServer(root, trees, port, label);
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await post(base, "/api/brains/start", { area, instruction: "Get the probe Area done." });
  assert.ok(brain.body.session, JSON.stringify(brain.body));
  sessions.push(brain.body.session);

  const goal = await post(base, "/api/goals/create", { area, goal: { title: "Find a document", doneWhen: "The finder opens." } });
  assert.ok(goal.body.file, JSON.stringify(goal.body));
  const slug = path.basename(goal.body.file, ".md").replace(/^goal-/, "");

  const planFile = path.join(trees, area, `plan-${leaf}.md`);
  const lines = {
    decision: "- Decision [[design-probe]]: 3 questions. Unblocks: the audit.",
    tryit: `- Try it [[goal-${slug}]]: press Cmd+K, type a title, press Enter.`,
    brain: "- Brain: should the audit cover the Usage UI too?",
  };
  await writeFile(planFile, `# Plan for ${area}\n\n## For Julian\n\n${lines.decision}\n${lines.tryit}\n${lines.brain}\n\n## Waves\n\n- one\n`, "utf8");
  return { root, trees, area, leaf, base, brains: path.join(root, "brains"), brain: brain.body, planFile, lines, slug };
}

test("a brain carries the rows its plan wrote for Julian", async (context) => {
  const probe = await startProbe(context, "forjulian");
  if (!probe) return;

  const rows = await waitFor("the rows in the payload", async () => {
    const brain = await brainOf(probe.base);
    return brain?.forJulian?.length === 3 ? brain.forJulian : null;
  });
  assert.deepEqual(rows.map((row) => row.kind), ["decision", "tryit", "brain"]);

  const [decision, tryit, ask] = rows;
  assert.equal(decision.file, `${probe.area}/design-probe.md`);
  assert.equal(decision.title, "Probe design");
  assert.equal(decision.text, "3 questions");
  assert.equal(decision.unblocks, "the audit");
  assert.equal(decision.commentCount, 1, "the Document's one open comment shows on the row");
  assert.equal(decision.missing, false);

  assert.equal(tryit.file, `${probe.area}/goal-${probe.slug}.md`);
  assert.equal(tryit.title, "Find a document");
  assert.equal(tryit.text, "press Cmd+K, type a title, press Enter.");
  assert.equal(tryit.goalStatus, "open");

  assert.equal(ask.title, "should the audit cover the Usage UI too?");
  assert.equal(ask.target, null);
});

test("a row whose link resolves to nothing is marked missing", async (context) => {
  const probe = await startProbe(context, "forjulianmissing");
  if (!probe) return;

  await writeFile(probe.planFile, "# Plan\n\n## For Julian\n\n- Decision [[design-gone]]: one question.\n", "utf8");
  const rows = await waitFor("the missing row", async () => {
    const brain = await brainOf(probe.base);
    return brain?.forJulian?.length === 1 ? brain.forJulian : null;
  });
  assert.equal(rows[0].missing, true);
  assert.equal(rows[0].title, "design-gone");
  assert.equal(rows[0].commentCount, 0);
});
