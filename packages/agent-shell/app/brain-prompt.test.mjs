import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

test("the brain prompt gives bounded authoritative command and harness discovery", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-brain-prompt-"));
  const trees = path.join(root, "trees");
  const ottoArea = path.join(trees, "otto", "probeotto");
  await mkdir(ottoArea, { recursive: true });
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(ottoArea, "probeotto.md"), "---\ntype: area\n---\n\n# Probe otto\n", "utf8");

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

  const ottoBrain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/probeotto", instruction: "Get the probe Area done." }),
  }).then((response) => response.json());
  openedSessions.push(ottoBrain.session);
  const ottoShow = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(ottoBrain.session)}`).then((response) => response.json());
  assert.match(ottoShow.prompt, /Before every Tangent mutation, run `tangent <noun> --help`/);
  assert.match(ottoShow.prompt, /tangent harness list --area otto\/probeotto/);
  assert.match(ottoShow.prompt, new RegExp(path.join(trees, "harnesses\\.md").replaceAll("/", "\\/")));
  assert.doesNotMatch(ottoShow.prompt, /tangent goal start <slug> --step/, "the prompt does not copy pipeline syntax");
  assert.doesNotMatch(ottoShow.prompt, /Every --launch in this Area is/, "the prompt does not copy a resolved catalog snapshot");
  const guidance = ottoShow.prompt.match(/Before every Tangent mutation,[\s\S]*?Never guess a Tangent command or launch id\./)?.[0] ?? "";
  assert.ok(guidance, "the command guidance is one detectable block");
  assert.ok(guidance.split(/\s+/).length <= 100, `command guidance stays bounded: ${guidance.split(/\s+/).length} words`);
});

test("the brain prompt keeps reviewed Goals open until Julian accepts the Test", async (context) => {
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

  assert.match(show.prompt, /Keep the Goal open until Julian approves that Request/, "the user approves a reviewed Goal before it becomes done");
  assert.match(show.prompt, /Before every handover, sweep `tangent goal list otto\/probesweep` and `tangent agent list`/, "sweep goal list and agent list before every handover");
  assert.match(show.prompt, /Add a Test request for each reviewed Goal/, "reviewed Goals become direct validation requests");
  assert.match(show.prompt, /You orchestrate work; you do not perform it/, "the brain is an orchestration interface, not a worker");
  assert.match(show.prompt, /Delegate every investigation, design, implementation, test, and review to a worker, even when the task looks small/, "all substantive work is delegated");
  assert.match(show.prompt, /Your own writes are limited to Tangent's orchestration records/, "the brain only writes orchestration state");
  assert.match(show.prompt, /Do not design their solutions/, "the Area plan does not become a brain-authored design");
  assert.doesNotMatch(show.prompt, /Look at the Area's repository when code answers a question better than a guess/, "the brain does not investigate code itself");
});

test("a pipeline step under a brain has one handover route and never chooses the next agent", async () => {
  const serverSource = await readFile(path.join(here, "server.mjs"), "utf8");
  assert.match(
    serverSource,
    /Run .*tangent handover.*This operation reports to the brain; it does not choose the next agent\./,
    "under a brain, a worker reports through one route and does not schedule work"
  );
  assert.match(
    serverSource,
    /If a real decision needs Julian, ask him here; this legacy pipeline waits\./,
    "a pipeline step with no brain on the Area keeps asking Julian directly"
  );
});

test("the brain prompt uses structured plan, decision, test, and approval requests", async (context) => {
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

  assert.match(show.prompt, /## Requests for Julian/, "the prompt names the request contract");
  assert.match(show.prompt, /create one short approval Request/, "the plan approval is explicit");
  assert.match(show.prompt, /kind is internal routing metadata/, "request kinds do not change the user contract");
  assert.match(show.prompt, /kind test/, "tests use a structured request");
  assert.match(show.prompt, /kind approval/, "one-way approvals use a structured request");
  assert.match(show.prompt, /Every Request uses Approve or I want these changes/, "all requests use one answer pair");
  assert.match(show.prompt, /Do not paste handovers, commit lists, test logs, or implementation narratives/, "requests exclude agent narration");
  assert.doesNotMatch(show.prompt, /## For Julian/, "Markdown is not the new control protocol");
  assert.doesNotMatch(show.prompt, /launchctl kickstart/, "the rebuild rule is one command, not a launchctl recipe");
});
