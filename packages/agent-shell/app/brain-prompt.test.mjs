// A brain gets no generated prompt (ADR-0041). It opens in its Area folder,
// where the harness reads the AGENTS.md chain, and Julian's own message is
// typed verbatim as its first message. These tests pin the message, the
// folder, and the links the server keeps in the vault.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { newBrain, readBrain, writeBrain } from "./brain-record.mjs";
import { ROOT_AREA } from "./area-identity.mjs";
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

/** Starts one test server over a fresh vault and returns its base URL and roots. */
async function startServer(context, { areaName, note = "---\ntype: area\n---\n\n# Probe\n" }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-first-message-"));
  const trees = path.join(root, "trees");
  const brains = path.join(root, "brains");
  const area = path.join(trees, ...areaName.split("/"));
  await mkdir(area, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), "```tangent.harnesses.v1\n{\"version\":1,\"harnesses\":[{\"id\":\"brain\",\"command\":\"brain-agent\"}]}\n```\n", "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n\n```tangent.environment.v1\n{\"defaults\":{\"brain\":{\"harness\":\"brain\"}}}\n```\n", "utf8");
  if (note) await writeFile(path.join(area, `${path.basename(area)}.md`), note, "utf8");
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
      TANGENT_BRAINS_ROOT: brains,
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "",
      CHAT_SESSION: `first-message-test-${process.pid}`,
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
  return { base, trees, brains, area, openedSessions };
}

/** Posts JSON and returns the parsed body. */
async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

/** Waits until one file exists, or gives up after a second. */
async function waitForFile(file) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await readlink(file); return true; } catch {}
    try { await readFile(file); return true; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

test("a brain starts in its Area folder with Julian's message as its first message", async (context) => {
  const server = await startServer(context, { areaName: "otto/probefirst", note: "---\ntype: area\n---\n\n# Probe first\n\n## Purpose\n\nThe probe.\n" });
  if (!server) return;
  const { base, trees, brains, area, openedSessions } = server;
  const message = "Get the probe Area done.\nStart with the flicker; I check that one myself.";
  const started = await post(base, "/api/brains/start", { area: "otto/probefirst", instruction: message });
  assert.ok(started.session, JSON.stringify(started));
  openedSessions.push(started.session);
  const record = await readBrain(brains, "otto/probefirst");
  const generation = record.generations.at(-1);
  assert.equal(generation.firstMessage, message, "Julian's words are typed verbatim; nothing is generated around them");
  assert.equal(generation.cwd, area, "the brain opens in its vault Area folder, where the harness reads the AGENTS.md chain");
  const show = await fetch(`${base}/api/brains/show?session=${encodeURIComponent(started.session)}`).then((response) => response.json());
  assert.equal(show.prompt, message);
  assert.doesNotMatch(String(show.prompt), /## Identity|## Work frontier|Activation provenance/, "no prompt section is generated");
  assert.equal(await waitForFile(path.join(area, "AGENTS.md")), true, "the sweep gave the Area its AGENTS.md link");
  assert.equal(await readlink(path.join(area, "AGENTS.md")), "probefirst.md");
  assert.equal(await readlink(path.join(area, "CLAUDE.md")), "AGENTS.md");
  assert.equal(await readlink(path.join(trees, "CLAUDE.md")), "AGENTS.md");
  assert.match(await readFile(path.join(trees, "AGENTS.md"), "utf8"), /^# Brains/, "the vault root AGENTS.md says how to be a brain");
  assert.equal(await waitForFile(path.join(trees, "otto", "AGENTS.md")), true);
  assert.equal(await readlink(path.join(trees, "otto", "AGENTS.md")), "otto.md");
  assert.equal(await readFile(path.join(area, "probefirst.md"), "utf8"), "---\ntype: area\n---\n\n# Probe first\n\n## Purpose\n\nThe probe.\n", "the sweep never rewrites a note");
});

test("Root appears first and its brain starts in the existing vault root", async (context) => {
  const server = await startServer(context, { areaName: "otto/proberoot" });
  if (!server) return;
  const { base, trees, brains, openedSessions } = server;
  const tree = await fetch(`${base}/api/tree`).then((response) => response.json());
  assert.equal(tree.areas[0].path, ROOT_AREA);
  assert.equal(tree.areas[0].name, "Root");
  assert.ok(tree.areas.some((area) => area.path === "otto"), "the existing top-level Area path did not move");

  const started = await post(base, "/api/brains/start", {
    area: ROOT_AREA,
    instruction: "Orient me from the complete tree.",
    choice: { harness: "brain" },
  });
  assert.ok(started.session, JSON.stringify(started));
  openedSessions.push(started.session);
  const record = await readBrain(brains, ROOT_AREA);
  assert.equal(record.generations.at(-1).cwd, trees);
  assert.equal(record.planFile, "plan-root.md");
});

test("a message to an Area with no brain founds one, and to a live brain it is queued", async (context) => {
  const server = await startServer(context, { areaName: "otto/probedescribe" });
  if (!server) return;
  const { base, brains, openedSessions } = server;
  const description = "Fix the flicker in the strip. Check it myself.";
  const opened = await post(base, "/api/work/describe", { area: "otto/probedescribe", description, sources: [] });
  assert.equal(opened.route, "brain-started", JSON.stringify(opened));
  openedSessions.push(opened.session);
  const record = await readBrain(brains, "otto/probedescribe");
  assert.match(record.generations.at(-1).firstMessage, /Fix the flicker in the strip\. Check it myself\./);
  assert.match(record.foundingInstruction.text, /Julian described work on Area otto\/probedescribe/);
  const again = await post(base, "/api/work/describe", { area: "otto/probedescribe", description: "Also the ramp.", sources: [] });
  assert.equal(again.route, "brain-opened", JSON.stringify(again));
  assert.equal(again.session, opened.session, "a live brain gets the message; no second attempt starts");
});

test("an Area with no note gets the template before its brain starts", async (context) => {
  const server = await startServer(context, { areaName: "otto/probeblank", note: "" });
  if (!server) return;
  const { area } = server;
  assert.equal(await waitForFile(path.join(area, "probeblank.md")), true);
  const note = await readFile(path.join(area, "probeblank.md"), "utf8");
  assert.equal(note, "---\ntype: area\nstatus: active\n---\n# Probeblank\n## Purpose\n\n## Knowledge\n\n## Current\n\n## Ideas and open questions\n");
  assert.doesNotMatch(note, /## Goals|## Resources/);
});

test("brain show keeps durable prompt access when live tmux observation fails", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-brain-show-degraded-"));
  const trees = path.join(root, "trees");
  const brains = path.join(root, "brains");
  const areaName = "otto/probedegraded";
  const area = path.join(trees, ...areaName.split("/"));
  const bin = path.join(root, "bin");
  await mkdir(area, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), "```tangent.harnesses.v1\n{\"version\":1,\"harnesses\":[{\"id\":\"brain\",\"command\":\"brain-agent\"}]}\n```\n", "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(path.join(area, "probedegraded.md"), "---\ntype: area\n---\n\n# Probe degraded\n", "utf8");
  await writeFile(path.join(bin, "tmux"), "#!/bin/sh\necho 'synthetic tmux observation failure' >&2\nexit 70\n", { mode: 0o755 });
  await writeBrain(brains, newBrain({
    area: areaName,
    instruction: "Keep organizing this Area.",
    planFile: `${areaName}/plan-probedegraded.md`,
  }));

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
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      PORT: String(port),
      HOST: "127.0.0.1",
      TREES_ROOT: trees,
      TANGENT_LOOPS_ROOT: path.join(root, "loops"),
      WORKSPACE: path.join(root, "workspace"),
      AGENT_SHELL_NO_OPEN: "1",
      AGENT_SHELL_TEST_NO_LAUNCH: "1",
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: brains,
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      GROQ_API_KEY: "",
      CHAT_SESSION: `brain-degraded-test-${process.pid}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base);

  const response = await fetch(`${base}/api/brains/show?area=${encodeURIComponent(areaName)}`);
  const show = await response.json();
  assert.equal(response.status, 200, show.error);
  assert.equal(show.brain.area, areaName);
  assert.equal(show.brain.live, false, "failed observation degrades only the ephemeral live state");
  assert.equal(show.prompt, "Keep organizing this Area.", "with no generation yet, the first message is the founding message itself");
});

test("a worker prompt ends with the one send command and no typed report contract", async () => {
  const serverSource = await readFile(path.join(here, "server.mjs"), "utf8");
  const closing = serverSource.match(/function workerSendSection\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(closing, /tangent send brain "<note>"/);
  assert.match(closing, /tangent send brain --done "<note>"/);
  assert.match(closing, /tangent send brain --blocked "<note>"/);
  assert.match(closing, /tangent send brain --question "<note>"/);
  assert.match(closing, /Do not run other tangent commands\. Do not change the Goal file's frontmatter\. The brain marks the Goal done\./);
  const prompts = serverSource.slice(serverSource.indexOf("async function goalPrompt("), serverSource.indexOf("async function pipelineStepPrompt("));
  assert.doesNotMatch(prompts, /--report|implementation-result|review-result|## Brain/, "the worker prompt has no typed report contract");
  assert.doesNotMatch(serverSource, /tangent handover|tangent goal handover|tangent agent send/, "old worker verbs are gone from the server");
  assert.doesNotMatch(serverSource, /rationaleDossierContract|tangent process list|tangent document resolve/, "the worker prompt teaches no other command");
});
