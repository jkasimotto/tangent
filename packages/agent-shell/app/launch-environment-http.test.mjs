import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

const REGISTRY = `# Harnesses

\`\`\`tangent.harnesses.v1
{
  "version": 1,
  "modelSets": {
    "claude": [
      { "id": "opus-4-6", "label": "Opus 4.6", "args": "--model claude-opus-4-6" }
    ]
  },
  "harnesses": [
    { "id": "claude-otto", "label": "Claude · Otto", "command": "CLAUDE_CONFIG_DIR=~/.claude-otto claude", "modelSet": "claude" },
    { "id": "pi-code", "label": "Pi Code", "command": "pi-code" },
    { "id": "test-sleeper", "label": "Test sleeper", "command": "sleep 300" }
  ]
}
\`\`\`
`;

test("launch options resolve the registry, and saving writes an Area default", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-shell-launch-"));
  const trees = path.join(root, "trees");
  const workspace = path.join(root, "workspace");
  const arbitraryDirectory = path.join(root, "arbitrary-worker-directory");
  const areaDirectory = path.join(trees, "otto", "test");
  await mkdir(areaDirectory, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await mkdir(arbitraryDirectory, { recursive: true });
  await writeFile(path.join(trees, "harnesses.md"), REGISTRY, "utf8");
  await writeFile(path.join(trees, "otto", "otto.md"), "---\ntype: area\n---\n\n# Otto\n", "utf8");
  await writeFile(
    path.join(areaDirectory, "test.md"),
    `---\ntype: area\n---\n\n# Test\n\n## Goals\n\n1. [[goal-prove-launch]]\n2. [[goal-default-pipeline]]\n3. [[goal-arbitrary-directory]]\n\n## Development environment\n\n\`\`\`tangent.environment.v1\n{"defaults": {"launch": {"harness": "claude-otto", "model": "opus-4-6"}}}\n\`\`\`\n\n## Resources\n\n- Repository: ${workspace}\n`,
    "utf8"
  );
  await writeFile(
    path.join(areaDirectory, "goal-prove-launch.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The launch is proven\nsession:\n---\n\n# Prove launch\n\n## State\n\nNot started.\n",
    "utf8"
  );
  await writeFile(
    path.join(areaDirectory, "goal-default-pipeline.md"),
    "---\ntype: goal\nstatus: open\ndone_when: Default pipeline launches are stable\nsession:\n---\n\n# Default pipeline\n\n## State\n\nNot started.\n",
    "utf8"
  );
  await writeFile(
    path.join(areaDirectory, "goal-arbitrary-directory.md"),
    "---\ntype: goal\nstatus: open\ndone_when: The worker uses its requested directory\nsession:\n---\n\n# Arbitrary directory\n\n## State\n\nNot started.\n",
    "utf8"
  );

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
      // Every durable-state root must leave ~/.tangent alone: this file's
      // server once reconciled the real pipeline records against its
      // isolated tmux and marked live workers stopped (2026-08-24).
      TANGENT_PIPELINES_ROOT: path.join(root, "pipelines"),
      TANGENT_BRAINS_ROOT: path.join(root, "brains"),
      TANGENT_ARMED_ROOT: path.join(root, "armed"),
      AGENT_MESSAGE_LOG: path.join(root, "messages.jsonl"),
      AGENT_SHELL_NO_OPEN: "1",
      GROQ_API_KEY: "",
      CHAT_SESSION: `launch-test-${process.pid}`,
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

  const missingArea = await fetch(`${base}/api/launch/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/missing", kind: "work", mode: "launch", launch: { harness: "pi-code" } }),
  });
  assert.equal(missingArea.status, 404);
  const unknownKind = await fetch(`${base}/api/launch/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", kind: "agent", mode: "launch", launch: { harness: "pi-code" } }),
  });
  assert.equal(unknownKind.status, 400);
  assert.match((await unknownKind.json()).error, /unknown default kind "agent"/);

  // The declared default resolves through the registry with display labels.
  const options = await fetch(`${base}/api/launch/options?area=otto/test`).then((response) => response.json());
  assert.deepEqual(options.harnesses.map((harness) => harness.label), ["Claude · Otto", "Pi Code", "Test sleeper"]);
  assert.equal(options.harnesses[0].models[0].label, "Opus 4.6");
  assert.deepEqual(options.harnesses[1].models, []);
  assert.equal(options.default.command, "CLAUDE_CONFIG_DIR=~/.claude-otto claude --model claude-opus-4-6");
  assert.equal(options.default.label, "Claude · Otto · Opus 4.6");
  assert.equal(options.default.source, "otto/test");
  assert.equal(options.source, path.join(trees, "harnesses.md"));
  assert.equal(options.harnesses[0].models[0].command, "CLAUDE_CONFIG_DIR=~/.claude-otto claude --model claude-opus-4-6");

  const catalog = await fetch(`${base}/api/launch/options?area=otto/test&kind=all`).then((response) => response.json());
  assert.equal(catalog.workDefault.command, "CLAUDE_CONFIG_DIR=~/.claude-otto claude --model claude-opus-4-6");
  assert.equal(catalog.brainDefault.command, "CLAUDE_CONFIG_DIR=~/.claude-otto claude --model claude-opus-4-6");
  assert.equal(catalog.default, undefined, "the catalog labels both defaults instead of inventing one generic default");
  assert.deepEqual(catalog.declarations, {
    work: { mode: "launch", launch: { harness: "claude-otto", model: "opus-4-6" } },
    brain: { mode: "inherit" },
  });

  const brain = await fetch(`${base}/api/brains/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", instruction: "Control launch tests.", choice: { harness: "test-sleeper" } }),
  }).then((response) => response.json());
  assert.ok(brain.session, JSON.stringify(brain));
  openedSessions.push(brain.session);

  // A start that names no brain caller is refused before anything is written
  // (D8): only the brain starts workers.
  const noBrain = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-default-pipeline.md", steps: [{ instruction: "First step", launch: { harness: "pi-code" } }] }),
  });
  assert.equal(noBrain.status, 403);
  assert.match((await noBrain.json()).error, /^only the brain starts workers\. Message it in Work \(a on the Area\) or run: tangent send otto\/test "<what you want>"$/);
  assert.equal((await fetch(`${base}/api/sessions`).then((response) => response.json())).pipelines.some((item) => item.goal === "otto/test/goal-default-pipeline.md"), false, "a refused start leaves no record");

  const pipelineStarted = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-default-pipeline.md", caller: brain.session, steps: [{ instruction: "First step", launch: { harness: "claude-otto", model: "opus-4-6" } }] }),
  });
  assert.equal(pipelineStarted.status, 200);
  const pipelineStartBody = await pipelineStarted.json();
  openedSessions.push(pipelineStartBody.session);
  assert.deepEqual(pipelineStartBody.pipeline.steps[0].launch, { harness: "claude-otto", model: "opus-4-6", effort: null });
  assert.equal(pipelineStartBody.pipeline.steps[0].path, null, "the record keeps an omitted path explicit");
  const defaultPaneDirectory = await new Promise((resolve, reject) => {
    execFile("tmux", ["display-message", "-p", "-t", `=${pipelineStartBody.session}:`, "#{pane_current_path}"], (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  });
  assert.equal(await realpath(defaultPaneDirectory), await realpath(workspace), "an omitted path still uses the Area repository");

  const arbitraryStarted = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-arbitrary-directory.md", caller: brain.session, steps: [{ instruction: "Work elsewhere", path: arbitraryDirectory, launch: { harness: "claude-otto", model: "opus-4-6" } }] }),
  });
  assert.equal(arbitraryStarted.status, 200);
  const arbitraryBody = await arbitraryStarted.json();
  openedSessions.push(arbitraryBody.session);
  assert.equal(arbitraryBody.pipeline.steps[0].path, arbitraryDirectory, "the pipeline record keeps the step path");
  const arbitraryPaneDirectory = await new Promise((resolve, reject) => {
    execFile("tmux", ["display-message", "-p", "-t", `=${arbitraryBody.session}:`, "#{pane_current_path}"], (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  });
  assert.equal(await realpath(arbitraryPaneDirectory), await realpath(arbitraryDirectory), "the pane uses the exact step path");
  const appended = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "otto/test/goal-default-pipeline.md", caller: brain.session, steps: [{ instruction: "Second step", path: arbitraryDirectory, launch: { harness: "claude-otto", model: "opus-4-6" } }] }),
  });
  assert.equal(appended.status, 200);
  const appendedBody = await appended.json();
  assert.deepEqual(appendedBody.pipeline.steps[1].launch, { harness: "claude-otto", model: "opus-4-6", effort: null });
  assert.equal(appendedBody.pipeline.steps[1].path, arbitraryDirectory, "append records the new step path");

  // A directory that does not resolve stops the append before anything is
  // written, and names itself: the error contract of design-goal-launch-environments.
  const missingDirectory = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "otto/test/goal-default-pipeline.md", caller: brain.session, steps: [{ instruction: "Third step", path: path.join(root, "no-such-directory"), launch: { harness: "pi-code" } }] }),
  });
  assert.equal(missingDirectory.status, 400);
  assert.match((await missingDirectory.json()).error, /step 3: no directory /);
  const relativeDirectory = await fetch(`${base}/api/pipelines/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "otto/test/goal-default-pipeline.md", caller: brain.session, steps: [{ instruction: "Third step", path: "relative/directory", launch: { harness: "pi-code" } }] }),
  });
  assert.equal(relativeDirectory.status, 400);
  assert.match((await relativeDirectory.json()).error, /is not an absolute directory/);

  // Work and Brain persist independently. Follow Work is an explicit Brain
  // policy, while Use inherited removes only the selected local key.
  /** Saves one default on the fixture Area. */
  const saveDefault = (body) => fetch(`${base}/api/launch/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto/test", ...body }),
  });
  assert.equal((await saveDefault({ kind: "work", mode: "launch", launch: { harness: "pi-code" } })).status, 200);
  let savedOptions = await fetch(`${base}/api/launch/options?area=otto/test&kind=all`).then((response) => response.json());
  assert.equal(savedOptions.workDefault.command, "pi-code");
  assert.equal(savedOptions.brainDefault.command, "pi-code");
  const stablePipeline = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.deepEqual(stablePipeline.pipelines.find((item) => item.goal === "otto/test/goal-default-pipeline.md").steps[1].launch, { harness: "claude-otto", model: "opus-4-6", effort: null });

  assert.equal((await saveDefault({ kind: "brain", mode: "launch", launch: { harness: "claude-otto", model: "opus-4-6" } })).status, 200);
  savedOptions = await fetch(`${base}/api/launch/options?area=otto/test&kind=all`).then((response) => response.json());
  assert.equal(savedOptions.workDefault.command, "pi-code");
  assert.match(savedOptions.brainDefault.command, /claude-otto/);
  assert.equal((await saveDefault({ kind: "brain", mode: "work" })).status, 200);
  savedOptions = await fetch(`${base}/api/launch/options?area=otto/test&kind=all`).then((response) => response.json());
  assert.equal(savedOptions.declarations.brain.mode, "work");
  assert.equal(savedOptions.brainDefault.command, "pi-code");
  assert.equal((await saveDefault({ kind: "brain", mode: "inherit" })).status, 200);
  assert.equal((await saveDefault({ kind: "work", mode: "inherit" })).status, 200);
  savedOptions = await fetch(`${base}/api/launch/options?area=otto/test&kind=all`).then((response) => response.json());
  assert.deepEqual(savedOptions.declarations, { work: { mode: "inherit" }, brain: { mode: "inherit" } });
  assert.equal(savedOptions.workDefault, null, "nothing declared resolves to nothing, never to a profile guess");
  assert.match(savedOptions.brainDefault.error, /no brain or work launch is declared/);

  // An Area that declares nothing reports nothing; the picker then has no
  // seeded choice and the server refuses a start that carries none.
  const undeclared = await fetch(`${base}/api/launch/options?area=otto`).then((response) => response.json());
  assert.equal(undeclared.default, null);

  // An unknown id in a per-run choice blocks the start and names the id.
  const bad = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-prove-launch.md", caller: brain.session, choice: { harness: "gemini" } }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /unknown harness "gemini"/);

  // Saving a selection writes the durable Area default into the note.
  const saved = await fetch(`${base}/api/launch/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "otto", launch: { harness: "pi-code" } }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.clone().json()).label, "Pi Code");
  const note = await readFile(path.join(trees, "otto", "otto.md"), "utf8");
  assert.match(note, /## Development environment/);
  assert.match(note, /"harness": "pi-code"/);
  const after = await fetch(`${base}/api/launch/options?area=otto`).then((response) => response.json());
  assert.equal(after.default.command, "pi-code");
  assert.equal(after.default.label, "Pi Code");
  const inheritedAfter = await fetch(`${base}/api/launch/options?area=otto/test`).then((response) => response.json());
  assert.equal(inheritedAfter.default.command, "pi-code");

  // The harness editor round trip: read the registry, save a change, and
  // see the new option in the next launch options without a restart.
  const editable = await fetch(`${base}/api/harnesses`).then((response) => response.json());
  assert.equal(editable.registry.harnesses.length, 3);
  editable.registry.modelSets.claude.push({ id: "haiku-4-5", label: "Haiku 4.5", args: "--model claude-haiku-4-5" });
  editable.registry.harnesses.push({ id: "agy", label: "Agy", command: "agy" });
  const savedRegistry = await fetch(`${base}/api/harnesses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(editable.registry),
  });
  assert.equal(savedRegistry.status, 200);
  const registryNote = await readFile(path.join(trees, "harnesses.md"), "utf8");
  assert.match(registryNote, /"haiku-4-5"/);
  const refreshed = await fetch(`${base}/api/launch/options?area=otto/test`).then((response) => response.json());
  assert.deepEqual(refreshed.harnesses.map((harness) => harness.id), ["claude-otto", "pi-code", "test-sleeper", "agy"]);
  assert.equal(refreshed.harnesses[0].models.length, 2);
  const invalid = await fetch(`${base}/api/harnesses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ harnesses: [{ id: "x", command: "x", modelSet: "nope" }] }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /unknown model set "nope"/);

  // Starting a Goal with an explicit choice types the exact composed
  // command into the shell pane without submitting it, and records the
  // display label on the session.
  const started = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-prove-launch.md", caller: brain.session, choice: { harness: "claude-otto", model: "opus-4-6" } }),
  });
  assert.equal(started.status, 200);
  const session = (await started.json()).session;
  openedSessions.push(session);
  const typed = await new Promise((resolve) => {
    let attempts = 0;
    /** Polls the pane until the primed command line appears. */
    const poll = () => {
      execFile("tmux", ["capture-pane", "-p", "-t", `=${session}:`], (error, stdout) => {
        if (!error && /CLAUDE_CONFIG_DIR/.test(stdout)) return resolve(stdout);
        if (attempts += 1, attempts > 40) return resolve(stdout ?? "");
        setTimeout(poll, 250);
      });
    };
    poll();
  });
  assert.match(typed, /CLAUDE_CONFIG_DIR=~\/\.claude-otto claude --model claude-opus-4-6/);
  const label = await new Promise((resolve) => {
    execFile("tmux", ["show-options", "-t", session, "-v", "@tangent_launch"], (error, stdout) => resolve((stdout ?? "").trim()));
  });
  assert.equal(label, "Claude · Otto · Opus 4.6");
  // The ids beside the label. Work prints these, because the label
  // "Claude · Otto · Opus 4.6" does not say which part is the model
  // (design-see-the-harness-model-effort-and-open-that-agent Decision 2).
  const ref = await new Promise((resolve) => {
    execFile("tmux", ["show-options", "-t", session, "-v", "@tangent_launch_ref"], (_error, stdout) => resolve((stdout ?? "").trim()));
  });
  assert.equal(ref, "claude-otto/opus-4-6");
  const listed = await fetch(`${base}/api/sessions`).then((response) => response.json());
  assert.equal(listed.sessions.find((item) => item.name === session).launchRef, "claude-otto/opus-4-6");

  // A second start cannot replace the Goal's authoritative queue.
  const reopened = await fetch(`${base}/api/goals/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "otto/test/goal-prove-launch.md", caller: brain.session, choice: { harness: "claude-otto", model: "opus-4-6" } }),
  });
  assert.equal(reopened.status, 409);
  assert.match((await reopened.json()).error, /already has an authoritative queue/);

  // A start that names no harness is refused. Tangent uses neither the Area
  // default nor the recorded command as a silent substitute.
  const registryWithoutDefault = await fetch(`${base}/api/harnesses`).then((response) => response.json());
  registryWithoutDefault.registry.harnesses = registryWithoutDefault.registry.harnesses.filter((harness) => harness.id !== "pi-code");
  assert.equal((await fetch(`${base}/api/harnesses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registryWithoutDefault.registry),
  })).status, 200);
  const removedDefault = await fetch(`${base}/api/launch/options?area=otto/test`).then((response) => response.json());
  assert.match(removedDefault.default.error, /otto: unknown harness "pi-code"/);
  // Removing a default does not rewrite the launch that the existing queue
  // recorded. The earlier second-start check already proves that no request
  // can replace this Goal's authoritative queue.
  const recordedCommand = await new Promise((resolve) => {
    execFile("tmux", ["show-options", "-t", session, "-v", "@tangent_launch_command"], (_error, stdout) => resolve((stdout ?? "").trim()));
  });
  assert.match(recordedCommand, /claude-otto claude --model claude-opus-4-6/, "the recorded assignment launch stays immutable");
});
