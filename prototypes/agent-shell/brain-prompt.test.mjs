import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("the brain prompt names the Area's resolved harness and uses it in every example launch", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-brain-prompt-"));
  const trees = path.join(root, "trees");
  const ottoArea = path.join(trees, "otto", "probeotto");
  const salesArea = path.join(trees, "sales", "probesales");
  await mkdir(ottoArea, { recursive: true });
  await mkdir(salesArea, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(ottoArea, "probeotto.md"), "---\ntype: area\n---\n\n# Probe otto\n", "utf8");
  await writeFile(path.join(trees, "sales", "sales.md"), "---\ntype: area\n---\n\n# Sales\n", "utf8");
  await writeFile(path.join(salesArea, "probesales.md"), "---\ntype: area\n---\n\n# Probe sales\n", "utf8");

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
  const openedSessions = [];
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
      CHAT_SESSION: `brain-prompt-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await Promise.all(openedSessions.map((session) => new Promise((resolve) => {
      execFile("tmux", ["kill-session", "-t", `=${session}`], () => resolve());
    })));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  // No harnesses.md registry: otto/** falls back to claude-otto, everything
  // else to plain claude (design-goal-launch-environments profile fallback).
  const ottoBrain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/probeotto", instruction: "Get the probe Area done." }),
  }).then((response) => response.json());
  openedSessions.push(ottoBrain.session);
  const ottoShow = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(ottoBrain.session)}`).then((response) => response.json());
  assert.match(ottoShow.prompt, /Every --launch in this Area is claude-otto\/<model>/);
  assert.match(ottoShow.prompt, /claude-otto\//);
  assert.doesNotMatch(ottoShow.prompt, /claude\//, "an otto/** brain prompt never launches plain claude");

  // A non-otto Area resolves the other half of the same fallback: plain
  // claude, proving the harness is genuinely resolved, not hard-coded.
  const salesBrain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "sales/probesales", instruction: "Get the probe Area done." }),
  }).then((response) => response.json());
  openedSessions.push(salesBrain.session);
  const salesShow = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(salesBrain.session)}`).then((response) => response.json());
  assert.match(salesShow.prompt, /Every --launch in this Area is claude\/<model>/);
  assert.doesNotMatch(salesShow.prompt, /claude-otto\//);
});

test("the brain prompt tells the brain to close finished Goals itself, not leave them waiting", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-brain-sweep-"));
  const trees = path.join(root, "trees");
  const area = path.join(trees, "otto", "probesweep");
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, "probesweep.md"), "---\ntype: area\n---\n\n# Probe sweep\n", "utf8");

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
  const openedSessions = [];
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
      CHAT_SESSION: `brain-sweep-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await Promise.all(openedSessions.map((session) => new Promise((resolve) => {
      execFile("tmux", ["kill-session", "-t", `=${session}`], () => resolve());
    })));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/probesweep", instruction: "Get the probe Area done." }),
  }).then((response) => response.json());
  openedSessions.push(brain.session);
  const show = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(brain.session)}`).then((response) => response.json());

  assert.match(show.prompt, /run `tangent goal done <slug>` in that same turn/, "run goal done in the same turn a review passes");
  assert.match(show.prompt, /Before every handover, sweep `tangent goal list otto\/probesweep` and `tangent agent list`/, "sweep goal list and agent list before every handover");
  assert.match(show.prompt, /a failure of the brain, not a question for Julian/, "a finished Goal left waiting is a failure, not a question for Julian");
});

test("a pipeline step under a brain sends its decisions and blockers to the brain, and never waits on Julian in its terminal", async () => {
  const serverSource = await readFile(path.join(here, "server.mjs"), "utf8");
  assert.match(
    serverSource,
    /If a real decision needs Julian, send it to the brain: .*tangent agent send \$\{brain\.session\}.*Keep going on the brain's answer or its own recommendation; never sit waiting for Julian in this terminal\. Julian decides in Documents and through the brain\./,
    "under a brain, a stuck pipeline step reports to the brain and keeps going, it never sits waiting for Julian"
  );
  assert.match(
    serverSource,
    /If a real decision needs Julian, ask him here; the pipeline waits\./,
    "a pipeline step with no brain on the Area keeps asking Julian directly"
  );
});

test("the brain prompt tells the brain the For Julian line shapes and the rebuild rule", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-brain-forjulian-"));
  const trees = path.join(root, "trees");
  const leaf = `probeforjulian${process.pid}`;
  const area = path.join(trees, "otto", leaf);
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, `${leaf}.md`), `---\ntype: area\n---\n\n# ${leaf}\n`, "utf8");

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
  const openedSessions = [];
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
      CHAT_SESSION: `brain-forjulian-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    await Promise.all(openedSessions.map((session) => new Promise((resolve) => {
      execFile("tmux", ["kill-session", "-t", `=${session}`], () => resolve());
    })));
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const brain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: `otto/${leaf}`, instruction: "Get the probe Area done." }),
  }).then((response) => response.json());
  openedSessions.push(brain.session);
  const show = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(brain.session)}`).then((response) => response.json());

  assert.match(show.prompt, /## For Julian/, "the prompt has the section that carries what waits on Julian");
  assert.match(show.prompt, /Tangent reads only that section/, "only the plan section is the list");
  assert.match(show.prompt, /- Decision \[\[<document>\]\]: <what it asks, one line>\. Unblocks: <what your answer unblocks>\./, "the Decision line shape");
  assert.match(show.prompt, /- Try it \[\[<goal-slug>\]\]: <where to go, what to press, what he sees; two lines at most>\./, "the Try it line shape");
  assert.match(show.prompt, /- Brain: <one question that fits no Document>\./, "the Brain line shape");
  assert.match(show.prompt, /run `tangent shell rebuild` before you write its Try it line/, "the server runs the new code before Julian presses anything");
  assert.match(show.prompt, /Julian clears Try it lines himself\. You clear Decision and Brain lines\./, "who clears which line");
  assert.match(show.prompt, /`tangent brain status` prints "Tangent shows N items for Julian"/, "the brain can check that its lines parsed");
  assert.match(show.prompt, /ask in the plan's For Julian section \(below\)/, "the decision rule points at the list");
  assert.doesNotMatch(show.prompt, /launchctl kickstart/, "the rebuild rule is one command, not a launchctl recipe");
});
