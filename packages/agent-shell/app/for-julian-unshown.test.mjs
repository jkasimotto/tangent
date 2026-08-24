// Hiding a line must never be silent (design-the-for-you-row-shows-only-
// direct-asks, Decision 5 B). These tests drive the real server: a plan whose
// For Julian section holds a line Tangent shows nothing for produces exactly
// one brain notice, a section that has not changed produces none, and a new
// bad line produces one more.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readInbox } from "./brain-inbox.mjs";
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

/**
 * Polls the server so a reconcile pass runs, then checks. The sweep only runs
 * on reconcile's own 10-second throttle (server.mjs lastReconcile), so this
 * needs a wall-clock budget, not a fixed attempt count.
 */
async function waitFor(base, what, check, budgetMs = 90_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await fetch(`${base}/api/sessions`).catch(() => {});
    const last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Keeps polling for long enough that at least two reconcile passes run. */
async function holdForTwoPasses(base) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await fetch(`${base}/api/sessions`).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Kills one tmux session; a session that is already gone is not an error. */
async function killSession(name) {
  await new Promise((resolve) => execFile("tmux", ["kill-session", "-t", `=${name}`], () => resolve()));
}

/** The notices this brain has on disk, newest last. */
async function notices(brains, area) {
  return (await readInbox(brains, area)).notices;
}

/** The notices that name unshown lines. */
async function unshownNotices(brains, area) {
  return (await notices(brains, area)).filter((notice) => notice.text.includes("not shown on Julian's desk"));
}

test("the brain hears about the lines Tangent does not show, once per plan change", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-unshown-"));
  const leaf = `unshown${process.pid}`;
  const trees = path.join(root, "trees");
  const area = `otto/${leaf}`;
  await mkdir(path.join(trees, "otto", leaf), { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), '```tangent.harnesses.v1\n{"version":1,"harnesses":[{"id":"test","command":"true"}]}\n```\n', "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), '---\ntype: area\n---\n\n# Otto\n\n```tangent.environment.v1\n{"version":1,"defaults":{"launch":{"harness":"test"}}}\n```\n', "utf8");
  await writeFile(path.join(trees, "otto", leaf, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n`, "utf8");
  await writeFile(path.join(trees, "otto", leaf, "design-probe.md"), "# Probe design\n\nA question.\n", "utf8");

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
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "",
      CHAT_SESSION: `unshown-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const sessions = [];
  context.after(async () => {
    for (const session of sessions) await killSession(session);
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const started = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area, instruction: "Get the probe Area done." }),
  }).then((response) => response.json());
  assert.ok(started.session, JSON.stringify(started));
  sessions.push(started.session);

  const brains = path.join(root, "brains");
  const planFile = path.join(trees, area, `plan-${leaf}.md`);
  const good = "- Decide [[design-probe]]: which of the 3 questions first?";
  const bad = "- Decide [[design-probe]]: 3 questions.";
  await writeFile(planFile, `# Plan\n\n## For Julian\n\n${good}\n${bad}\n`, "utf8");

  const first = await waitFor(base, "the first unshown-lines notice", async () => {
    const found = await unshownNotices(brains, area);
    return found.length ? found : null;
  });
  assert.equal(first.length, 1, JSON.stringify(first));
  assert.match(first[0].text, /1 line in your plan's For Julian section is not shown on Julian's desk/);
  assert.match(first[0].text, /"- Decide \[\[design-probe\]\]: 3 questions\."/, "the notice names the line");
  assert.match(first[0].text, /Run tangent brain status to see what parses/);

  // The same section, seen again and again, says nothing more.
  await holdForTwoPasses(base);
  assert.equal((await unshownNotices(brains, area)).length, 1, "an unchanged section never nags");

  // A new bad line is a new plan change, so it is heard once.
  await writeFile(planFile, `# Plan\n\n## For Julian\n\n${good}\n${bad}\n- Idea: not a shape at all.\n`, "utf8");
  const second = await waitFor(base, "the second notice", async () => {
    const found = await unshownNotices(brains, area);
    return found.length === 2 ? found : null;
  });
  assert.match(second[1].text, /2 lines in your plan's For Julian section are not shown/);

  // A section with nothing hidden says nothing at all.
  await writeFile(planFile, `# Plan\n\n## For Julian\n\n${good}\n`, "utf8");
  await holdForTwoPasses(base);
  assert.equal((await unshownNotices(brains, area)).length, 2, "a clean section is not an event");
});
