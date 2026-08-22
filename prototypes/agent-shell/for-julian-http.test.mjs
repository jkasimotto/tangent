// Under a live brain, only the brain says what needs Julian, and every row it
// writes is a direct ask (design contract: otto/tangent/design-the-for-you-
// row-shows-only-direct-asks). These tests drive the real server: the brain
// writes a `## For Julian` section in its plan, the desk payload carries the
// parsed Decide and Test rows with their titles and comment counts, the lines
// Tangent shows nothing for travel with the record, a row leaves with an undo,
// and a saved comment on a listed Document wakes the brain.

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

/** Runs one git command in the test vault, with no user configuration. */
async function git(trees, ...args) {
  await new Promise((resolve, reject) => {
    execFile("git", ["-C", trees, ...args], { env: GIT_ENV }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** The environment that keeps the test vault's git out of the machine's configuration. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Tangent Test",
  GIT_AUTHOR_EMAIL: "test@tangent.local",
  GIT_COMMITTER_NAME: "Tangent Test",
  GIT_COMMITTER_EMAIL: "test@tangent.local",
};

/** Makes the test vault a git repository with every file tracked. */
async function initGit(trees) {
  await git(trees, "init", "-q", "-b", "main");
  await git(trees, "add", "-A");
  await git(trees, "commit", "-q", "-m", "add: the probe vault");
}

/** The subjects of the vault's commits, newest first. */
async function gitSubjects(trees) {
  const out = await new Promise((resolve) => {
    execFile("git", ["-C", trees, "log", "--format=%s"], { env: GIT_ENV }, (error, stdout) => resolve(error ? "" : stdout));
  });
  return out.split("\n").filter(Boolean);
}

/** Starts one Agent Shell server against the given roots. */
function startServer(root, trees, port, label) {
  return spawn(process.execPath, ["server.mjs"], {
    cwd: here,
    env: {
      ...GIT_ENV,
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
 * the plan's `## For Julian` section with one line of each shape. Returns the
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
    decide: "- Decide [[design-probe]]: which of the 3 questions first? Unblocks: the audit.",
    test: `- Test [[goal-${slug}]]: press Cmd+K, type a title, press Enter.`,
    free: "- Decide: should the audit cover the Usage UI too?",
  };
  await writeFile(planFile, `# Plan for ${area}\n\n## For Julian\n\n${lines.decide}\n${lines.test}\n${lines.free}\n\n## Waves\n\n- one\n`, "utf8");
  // Every file is tracked, so the vault's own commits (a Tried it, a comment
  // save) land in its history the way they do in the real vault.
  await initGit(trees);
  return { root, trees, area, leaf, base, brains: path.join(root, "brains"), brain: brain.body, planFile, lines, slug };
}

test("a brain carries the rows its plan wrote for Julian", async (context) => {
  const probe = await startProbe(context, "forjulian");
  if (!probe) return;

  const rows = await waitFor("the rows in the payload", async () => {
    const brain = await brainOf(probe.base);
    return brain?.forJulian?.length === 3 ? brain.forJulian : null;
  });
  assert.deepEqual(rows.map((row) => row.kind), ["decide", "test", "decide"]);

  const [decide, testRow, free] = rows;
  assert.equal(decide.file, `${probe.area}/design-probe.md`);
  assert.equal(decide.title, "Probe design");
  assert.equal(decide.text, "which of the 3 questions first?", "the ask keeps its question mark");
  assert.equal(decide.unblocks, "the audit");
  assert.equal(decide.commentCount, 1, "the Document's one open comment shows on the row");
  assert.equal(decide.missing, false);

  assert.equal(testRow.file, `${probe.area}/goal-${probe.slug}.md`);
  assert.equal(testRow.title, "Find a document");
  assert.equal(testRow.text, "press Cmd+K, type a title, press Enter.");
  assert.equal(testRow.goalStatus, "open");

  assert.equal(free.title, "should the audit cover the Usage UI too?");
  assert.equal(free.target, null);
});

test("the lines Tangent shows nothing for travel with the record", async (context) => {
  const probe = await startProbe(context, "forjulianunparsed");
  if (!probe) return;

  await waitFor("the rows in the payload", async () => (await brainOf(probe.base))?.forJulian?.length === 3);
  const shown = await get(probe.base, `/api/brains/show?area=${encodeURIComponent(probe.area)}`);
  assert.deepEqual(shown.brain.forJulianUnparsed, [], "every line of the probe plan is a row");

  await writeFile(probe.planFile, `# Plan\n\n## For Julian\n\n${probe.lines.decide}\n- Decide [[design-probe]]: 3 questions.\n- Idea: not a shape at all.\n`, "utf8");
  const unparsed = await waitFor("the unshown lines", async () => {
    const brain = (await get(probe.base, `/api/brains/show?area=${encodeURIComponent(probe.area)}`)).brain;
    return brain.forJulianUnparsed?.length === 2 ? brain.forJulianUnparsed : null;
  });
  assert.deepEqual(unparsed, ["- Decide [[design-probe]]: 3 questions.", "- Idea: not a shape at all."]);
});

test("a row whose link resolves to nothing is marked missing", async (context) => {
  const probe = await startProbe(context, "forjulianmissing");
  if (!probe) return;

  await writeFile(probe.planFile, "# Plan\n\n## For Julian\n\n- Decide [[design-gone]]: which one?\n", "utf8");
  const rows = await waitFor("the missing row", async () => {
    const brain = await brainOf(probe.base);
    return brain?.forJulian?.length === 1 ? brain.forJulian : null;
  });
  assert.equal(rows[0].missing, true);
  assert.equal(rows[0].title, "design-gone");
  assert.equal(rows[0].commentCount, 0);
});

test("Tried it removes one Test line, and undo puts it back", async (context) => {
  const probe = await startProbe(context, "forjuliantried");
  if (!probe) return;

  await waitFor("the rows in the payload", async () => (await brainOf(probe.base))?.forJulian?.length === 3);

  const tried = await post(probe.base, "/api/brains/tried", { area: probe.area, line: probe.lines.test });
  assert.equal(tried.status, 200, JSON.stringify(tried.body));
  assert.equal(tried.body.index, 2, "the body index counts the blank line under the heading");
  assert.equal((await readFile(probe.planFile, "utf8")).includes(probe.lines.test), false);
  const left = await waitFor("the row to leave the payload", async () => {
    const rows = (await brainOf(probe.base))?.forJulian ?? [];
    return rows.length === 2 ? rows : null;
  });
  assert.deepEqual(left.map((row) => row.kind), ["decide", "decide"]);
  assert.equal((await gitSubjects(probe.trees))[0], `update: ${probe.area} plan tried it ${probe.slug}`);

  const undo = await post(probe.base, "/api/brains/tried/undo", { area: probe.area, line: probe.lines.test, index: tried.body.index });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  const back = await waitFor("the row to come back", async () => {
    const rows = (await brainOf(probe.base))?.forJulian ?? [];
    return rows.length === 3 ? rows : null;
  });
  assert.deepEqual(back.map((row) => row.kind), ["decide", "test", "decide"]);
  assert.equal((await gitSubjects(probe.trees))[0], `update: ${probe.area} plan restore try it ${probe.slug}`);

  const decision = await post(probe.base, "/api/brains/tried", { area: probe.area, line: probe.lines.decide });
  assert.equal(decision.status, 400, JSON.stringify(decision.body));
  const unknown = await post(probe.base, "/api/brains/tried", { area: probe.area, line: "- Test [[goal-nothing]]: nothing." });
  assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
  const noBrain = await post(probe.base, "/api/brains/tried", { area: "otto/nowhere", line: probe.lines.test });
  assert.equal(noBrain.status, 404, JSON.stringify(noBrain.body));
  assert.equal((await brainOf(probe.base)).forJulian.length, 3, "a refused press changes nothing");

  // A stopped brain's rows stay on the desk, so its Test row is still
  // Julian's to clear.
  await killSession(probe.brain.session);
  await waitFor("the brain to be stopped", async () => (await brainOf(probe.base))?.live === false);
  const stopped = await post(probe.base, "/api/brains/tried", { area: probe.area, line: probe.lines.test });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  assert.equal((await readFile(probe.planFile, "utf8")).includes(probe.lines.test), false);
});

test("Tried it drops a Test entry's continuation line too, and undo restores both", async (context) => {
  const probe = await startProbe(context, "forjuliantriedtwo");
  if (!probe) return;

  const first = `- Test [[goal-${probe.slug}]]: press Cmd+K, type a title.`;
  const continuation = "  Then press Enter; the finder opens on the first hit.";
  await writeFile(
    probe.planFile,
    `# Plan for ${probe.area}\n\n## For Julian\n\n${probe.lines.decide}\n${first}\n${continuation}\n${probe.lines.free}\n\n## Waves\n\n- one\n`,
    "utf8"
  );
  await waitFor("the rows in the payload", async () => (await brainOf(probe.base))?.forJulian?.length === 3);

  const tried = await post(probe.base, "/api/brains/tried", { area: probe.area, line: first });
  assert.equal(tried.status, 200, JSON.stringify(tried.body));
  assert.equal(tried.body.removedText, `${first}\n${continuation}`);
  const planText = await readFile(probe.planFile, "utf8");
  assert.equal(planText.includes(first), false);
  assert.equal(planText.includes(continuation), false, "the continuation line does not dangle");

  const undo = await post(probe.base, "/api/brains/tried/undo", { area: probe.area, line: tried.body.removedText, index: tried.body.index });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  const restored = await readFile(probe.planFile, "utf8");
  assert.ok(restored.includes(first) && restored.includes(continuation), "undo brings both lines back");
});

test("Julian marks a Decide row handled from its row, and the brain is told", async (context) => {
  const probe = await startProbe(context, "forjuliandecision");
  if (!probe) return;

  await waitFor("the rows in the payload", async () => (await brainOf(probe.base))?.forJulian?.length === 3);

  const done = await post(probe.base, "/api/brains/decision-done", { area: probe.area, line: probe.lines.decide });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.removedText, probe.lines.decide, "undo restores what actually left the plan");
  assert.equal((await readFile(probe.planFile, "utf8")).includes(probe.lines.decide), false);
  const left = await waitFor("the row to leave the payload", async () => {
    const rows = (await brainOf(probe.base))?.forJulian ?? [];
    return rows.length === 2 ? rows : null;
  });
  assert.deepEqual(left.map((row) => row.kind), ["test", "decide"]);
  assert.equal((await gitSubjects(probe.trees))[0], `update: ${probe.area} plan decision design-probe handled`);
  const notices = await waitFor("the brain's notice on disk", async () => {
    const inbox = await readInbox(probe.brains, probe.area);
    return inbox.notices.length ? inbox.notices : null;
  });
  assert.equal(notices.some((notice) => notice.text === "Julian marked Decision design-probe done"), true, JSON.stringify(notices));

  const undo = await post(probe.base, "/api/brains/decision-done/undo", { area: probe.area, line: probe.lines.decide, index: done.body.index });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  const back = await waitFor("the row to come back", async () => {
    const rows = (await brainOf(probe.base))?.forJulian ?? [];
    return rows.length === 3 ? rows : null;
  });
  assert.deepEqual(back.map((row) => row.kind), ["decide", "test", "decide"]);

  const tryit = await post(probe.base, "/api/brains/decision-done", { area: probe.area, line: probe.lines.test });
  assert.equal(tryit.status, 400, JSON.stringify(tryit.body));
  const unknown = await post(probe.base, "/api/brains/decision-done", { area: probe.area, line: "- Decide [[design-nothing]]: nothing?" });
  assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
});

test("Julian presses Reply on a row, and the brain is told its subject", async (context) => {
  const probe = await startProbe(context, "forjulianreply");
  if (!probe) return;

  await waitFor("the rows in the payload", async () => (await brainOf(probe.base))?.forJulian?.length === 3);

  const reply = await post(probe.base, "/api/brains/reply", { area: probe.area, subject: "design-probe" });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  const notices = await waitFor("the brain's notice on disk", async () => {
    const inbox = await readInbox(probe.brains, probe.area);
    return inbox.notices.length ? inbox.notices : null;
  });
  assert.equal(notices.some((notice) => notice.text === "Julian is replying about: design-probe"), true, JSON.stringify(notices));

  const noSubject = await post(probe.base, "/api/brains/reply", { area: probe.area, subject: "" });
  assert.equal(noSubject.status, 400, JSON.stringify(noSubject.body));
  const noBrain = await post(probe.base, "/api/brains/reply", { area: "otto/nowhere", subject: "x" });
  assert.equal(noBrain.status, 404, JSON.stringify(noBrain.body));
});

test("a saved comment on a listed Document wakes its brain, and only that Document does", async (context) => {
  const probe = await startProbe(context, "forjuliancomment");
  if (!probe) return;

  await waitFor("the rows in the payload", async () => (await brainOf(probe.base))?.forJulian?.length === 3);

  /** Saves one Document with the text a fresh read gives, plus the added line. */
  const comment = async (file, added) => {
    const current = await get(probe.base, `/api/document?file=${encodeURIComponent(file)}`);
    assert.ok(current.hash, JSON.stringify(current));
    const saved = await post(probe.base, "/api/document", { file, text: `${current.text}${added}`, baseHash: current.hash, summary: "commented" });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    return saved.body;
  };

  const listed = `${probe.area}/design-probe.md`;
  await comment(listed, "\nAnother point. {>>Julian: do the second one<<}\n");
  const notices = await waitFor("the notice on disk", async () => {
    const inbox = await readInbox(probe.brains, probe.area);
    return inbox.notices.length ? inbox.notices : null;
  });
  assert.equal(notices.length, 1);
  assert.equal(
    notices[0].text,
    `Julian commented on ${listed} (2 open comments). Read them with tangent document comments ${listed}; remove the Decide line from the plan when you have what you need.`
  );

  // A save that removes a comment is not an answer: an Undo never wakes the brain.
  const after = await get(probe.base, `/api/document?file=${encodeURIComponent(listed)}`);
  const withoutOne = await post(probe.base, "/api/document", {
    file: listed,
    text: after.text.replace("{>>Julian: do the second one<<}", ""),
    baseHash: after.hash,
    summary: "removed a comment",
  });
  assert.equal(withoutOne.status, 200, JSON.stringify(withoutOne.body));

  // A Document no Decide row names is not the brain's business.
  await comment(`${probe.area}/design-quiet.md`, "\nA thought. {>>Julian: and this?<<}\n");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await readInbox(probe.brains, probe.area)).notices.length, 1, "only a listed Document wakes the brain");
});
